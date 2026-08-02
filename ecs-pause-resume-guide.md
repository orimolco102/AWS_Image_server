# Cloud Storage Class — Pause & Resume Guide

Project: `cloud-storage-service` on ECS Fargate, ALB `cloud-alb`, VPC `cloud-storage-class-vpc`

---

## Current setup reference

| Resource | Value |
|---|---|
| Cluster | `CSC-cluster` |
| Service | `cloud-storage-service` |
| Task definition family | `cloud-storage-task` |
| ECR repo | `308916794056.dkr.ecr.eu-central-1.amazonaws.com/cloud_storage` |
| Target group | `app-target-group` (port 3000, target type IP) |
| Load balancer | `cloud-alb` (HTTP:80) |
| VPC | `cloud-storage-class-vpc` |
| App subnets | `csc-app-subnet1-eu-central-1a`, `csc-app-subnet2-eu-central-1b` |
| Public subnets | `csc-public-subnet1-eu-central-1a`, `csc-public-subnet2-eu-central-1b` |
| Security groups | `sg-alb` (80/443 from internet), `sg-app` (3000 from `sg-alb`) |
| Task role | `cloud-storage-task-role` (S3 access to `ori-aws-nodejs`) |
| S3 bucket | `ori-aws-nodejs` |
| Region | `eu-central-1` |

---

## Pausing (to stop costs)

### 1. Scale ECS service to 0 tasks
```powershell
aws ecs update-service --cluster CSC-cluster --service cloud-storage-service --desired-count 0 --region eu-central-1
```
Stops Fargate compute billing. Config stays intact.

### 2. Delete the NAT Gateway
NAT gateways bill ~$0.05/hour + data processing even at zero traffic (~$35-40/month idle). Delete via:

**Console:** VPC → NAT Gateways → `ctc-nat` → Actions → Delete

**CLI:**
```powershell
aws ec2 delete-nat-gateway --nat-gateway-id <nat-gateway-id> --region eu-central-1
```

### 3. (Optional, for max savings) Delete the ALB
Bills ~$16-20/month even idle. Only delete if you're pausing for a long time and don't mind recreating it (target group, listener, service load-balancer attachment) later.

**Console:** EC2 → Load Balancers → `cloud-alb` → Actions → Delete

### Leave these running (free or negligible cost when idle)
- VPC, subnets, route tables, security groups, Internet Gateway — free
- Task definitions — free (metadata only)
- ECR images — a few cents/month storage
- S3 bucket — pay only for stored data
- CloudWatch Logs — negligible unless very high volume

---

## Resuming (to bring it back up)

### 1. Recreate the NAT Gateway
**VPC Console → NAT Gateways → Create NAT gateway**
- Subnet: a public subnet, e.g. `csc-public-subnet1-eu-central-1a`
- Connectivity: Public
- Allocate a new Elastic IP (or reuse an existing unattached one)
- Create, wait until status = `Available`, note the new NAT Gateway ID

### 2. Update app subnet route tables to point at the new NAT
For **both**:
- `ctc-app-subnet1-route-table`
- `ctc-app-subnet2-route-table`

**VPC → Route Tables → select table → Routes tab → Edit routes**
- Update the `0.0.0.0/0` route's target to the new NAT Gateway ID
- Save

### 3. (Only if you deleted the ALB) Recreate ALB + target group
1. Create target group `app-target-group`: type IP, HTTP, port 3000, VPC `cloud-storage-class-vpc`, health check path `/health`, leave targets empty
2. Create ALB `cloud-alb`: internet-facing, VPC `cloud-storage-class-vpc`, both public subnets, security group `sg-alb`, listener HTTP:80 → forward to `app-target-group`
3. Update the ECS service to attach this load balancer/listener/target group (Load balancing section of service update)

### 4. Scale the ECS service back up
```powershell
aws ecs update-service --cluster CSC-cluster --service cloud-storage-service --desired-count 1 --region eu-central-1
```

### 5. Verify
```powershell
aws ecs describe-services --cluster CSC-cluster --services cloud-storage-service --region eu-central-1 --query "services[0].deployments"
```
Check:
- ECS → Tasks tab → status `RUNNING`
- EC2 → Target Groups → `app-target-group` → Targets tab → status `healthy`

### 6. Test
```
http://<your-alb-dns-name>
```
(ALB DNS name unchanged if you kept the ALB — only the NAT gateway needed recreating)

---

## Deploying a new code change (reference)

1. Edit code, **save the file** (double-check!)
2. Rebuild image with a new version tag (ECR repo has immutable tags):
   ```powershell
   docker build --no-cache -t aws_class:prod .
   docker tag aws_class:prod 308916794056.dkr.ecr.eu-central-1.amazonaws.com/cloud_storage:vN
   docker push 308916794056.dkr.ecr.eu-central-1.amazonaws.com/cloud_storage:vN
   ```
3. Sanity-check the pushed image has your fix before touching ECS:
   ```powershell
   docker run --rm 308916794056.dkr.ecr.eu-central-1.amazonaws.com/cloud_storage:vN cat app.js
   ```
4. ECS → Task Definitions → `cloud-storage-task` → Create new revision → update Image URI to `:vN` → Create
5. Point the service at the new revision:
   ```powershell
   aws ecs update-service --cluster CSC-cluster --service cloud-storage-service --task-definition cloud-storage-task:<new-revision-number> --force-new-deployment --region eu-central-1
   ```
6. Wait for `rolloutState: COMPLETED`, hard refresh browser, test.

---

## Common troubleshooting notes

- **504 from ALB** → check target group health status first (EC2 → Target Groups → Targets tab)
- **Tasks going to `STOPPED`** → click the task → check "Stopped reason" (usually image pull failure from missing NAT/route, or missing task execution role permissions)
- **CORS errors** → `allowedOrigin` array in `app.js` must include the exact origin (scheme + host, no path) of whatever is calling the API
- **S3 upload failing (500)** → check CloudWatch Logs (`/ecs/...` log group → latest log stream) for the actual error; usually task role permissions or missing env vars (`AWS_REGION`, `S3_BUCKET`)
- **Browser showing stale JS** → hard refresh (`Ctrl+Shift+R`) — static files get cached aggressively
