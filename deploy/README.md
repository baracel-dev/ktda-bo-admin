# Deploying the KTDA Back Office to the UAT EC2 box

The KTDA Back Office is served on the UAT box (`3.226.168.177`) by nginx, under
`/admin/` on port `8185`, behind the shared ALB **ktda-apps-lb** that already
fronts the KTDA stub apps (`/backoffice`, `/farmer`, `/agent`, `/merchant` on
8181-8184) and terminates TLS. nginx serves the built SPA and reverse-proxies
the backends on the **same box over plaintext localhost**, so there is no CORS,
the engine's session cookie works, and none of the self-signed-certificate
trouble a Cloudflare Pages build hits.

Public URL: **https://ktda-apps-lb-1116460916.us-east-1.elb.amazonaws.com/admin/**

| Browser calls | nginx forwards to |
|---|---|
| `/admin/tok/*` | the accounting engine, `127.0.0.1:8086/api/*` (sign-in, session, live data) |
| `/admin/omni/*` | omnichannel's staff endpoints, `127.0.0.1:8087/*` |
| anything else under `/admin/` | the app (`/var/www/ktda-bo-admin`, falling back to `index.html`) |
| `/` | a `200 ok` health stub for the ALB target group |

The SPA is built with **Vite base `/admin/`** (and React Router basename
`/admin`), and `VITE_TOK_BASE=/admin/tok` / `VITE_OMNI_BASE=/admin/omni`, so
every asset and API URL carries the prefix the ALB routes on.

## Institution scoping (and a UAT security note)

omnichannel runs its **dev profile** on UAT: it scopes every operator call to
the institution in `X-Dev-Institution` and names the actor in `X-Dev-Subject`,
and needs **both** headers or it falls back to its own default institution. The
`/admin/omni/` location sets them itself, overriding anything the browser
sends:

- `X-Dev-Institution: 2d878f14-0d76-4aa0-b9d7-ffe4ace1562e` (KTDA), from the
  config, so a client cannot choose the institution;
- `X-Dev-Subject`: the signed-in operator. The back office sends the staff
  member's subject (`staff:<email>`) as `X-Operator-Subject` on every
  omnichannel call, and nginx passes it on as `X-Dev-Subject` (the
  `$ktda_bo_operator` map). Anything not of that shape, or no header (curl, the
  deploy smoke check), is the shared `ktda-operator`, as before. Payment runs
  need this: omnichannel's maker-checker refuses a release by the operator who
  submitted the run, so with one shared subject no run could be released.

`/admin/omni/api/operator/bulk-loads/upload` has its own location: 100 MB body
(a 600,000-line SAP file is about 85 MB) and 10-minute body, send and read
timeouts. The rest of `/admin/omni/` keeps 64 MB and 300 s. (Omnichannel itself takes
bulk files up to 200 MB, `BULK_LOAD_MAX_FILE_SIZE`; this site's 100 MB is the lower limit, and the
back office refuses a larger file before sending it.)

> **Security (UAT only):** there is no session gate in front of
> `/admin/omni/*`, and the operator subject is what the browser says it is. It
> keeps honest operators apart; it does not stop one posing as another. This is
> acceptable for the UAT dev environment only. Production must use the secured
> omnichannel profile with real staff tokens (the Cloudflare `functions/omni`
> proxy and the dev proxy already derive the subject from the verified engine
> session and ignore `X-Operator-Subject`).

## Deploy

**Option A — GitHub Actions.** *Actions → Deploy to EC2 → Run workflow.* It
builds, provisions nginx on `:8185`, syncs the build and runs a smoke check
(`GET /admin/` is 200, and `/admin/omni/api/operator/institutions` returns
KTDA). Pushing to `main` does not deploy — it only runs when started by hand.

Needs the repository secret the KTDA stub apps' deploy uses:

```
gh secret set UAT_EC2_SSH_KEY --repo baracel-dev/ktda-bo-admin < uat.pem
```

**Option B — by hand**, from the repo root (when the box is reachable only from
your machine, e.g. via EC2 Instance Connect):

```
deploy/deploy.sh 3.226.168.177 ~/keys/uat.pem
```

Both end with the same smoke check.

## One-time: add the ALB route

The ALB does not yet route `/admin` anywhere. Once, create a target group for
`:8185`, register the box, and add a path rule on the HTTPS:443 listener
(reusing the existing cert) — alongside the stub apps' rules, without touching
them:

```
LB=ktda-apps-lb-1116460916.us-east-1.elb.amazonaws.com           # region us-east-1
VPC=$(aws ec2 describe-instances --region us-east-1 --instance-ids i-0e1cdfbe0495615bb \
      --query 'Reservations[0].Instances[0].VpcId' --output text)

TG=$(aws elbv2 create-target-group --region us-east-1 --name ktda-bo-admin-tg \
      --protocol HTTP --port 8185 --vpc-id "$VPC" --target-type instance \
      --health-check-path / --matcher HttpCode=200 \
      --query 'TargetGroups[0].TargetGroupArn' --output text)

aws elbv2 register-targets --region us-east-1 --target-group-arn "$TG" \
      --targets Id=i-0e1cdfbe0495615bb,Port=8185

L443=$(aws elbv2 describe-listeners --region us-east-1 \
      --load-balancer-arn $(aws elbv2 describe-load-balancers --region us-east-1 \
        --names ktda-apps-lb --query 'LoadBalancers[0].LoadBalancerArn' --output text) \
      --query "Listeners[?Port==\`443\`].ListenerArn" --output text)

aws elbv2 create-rule --region us-east-1 --listener-arn "$L443" --priority 50 \
      --conditions Field=path-pattern,Values='/admin,/admin/*' \
      --actions Type=forward,TargetGroupArn="$TG"
```

## What `provision-ktda-bo-admin.sh` does (idempotent)

Installs nginx if missing, installs `nginx/ktda-bo-admin.conf`, creates
`/var/www/ktda-bo-admin` and labels it for SELinux, allows nginx to listen on
`:8185` (`http_port_t`) and to make outbound connections
(`httpd_can_network_connect`, without which the proxies 502), opens `:8185` in
firewalld if it is running, then `nginx -t` and enables nginx. It shares the
`/tmp/ktda-provision.lock` flock with the stub apps' provisioning so concurrent
deploys don't race on the SELinux policy store.

## Prerequisites

The engine (`8086`) and omnichannel (`8087`) running on the box — both already
front the `tokenization-engine-lb` / `tokenization-omnichannel-lb` target groups
and report healthy. If the engine is down the app loads but calls return 502.
