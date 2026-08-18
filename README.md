# Capacity Planner

Single-page capacity planner. Static files on S3, HTTPS via CloudFront.

The CloudFront Function [`capacity-planner`](https://us-east-1.console.aws.amazon.com/cloudfront/v3/home?region=us-east-1#/functions/capacity-planner) rewrites SPA routes to `index.html`.

## Local

```bash
npm install
npm run dev
```

## GitHub Actions deploy

A merge (or push) to `master` runs `.github/workflows/deploy.yml`: build, create/update the CloudFormation stack, upload `dist/`, invalidate CloudFront.

One-time setup (SSO role **PowerUserWithIAMFullAccess**):

```bash
export AWS_CONFIG_FILE="$PWD/infra/aws-config"
aws sso login --profile capacity-planner

# 1. Site stack (S3 + CloudFront + function)
npm run deploy

# 2. GitHub OIDC deploy role
aws cloudformation deploy \
  --template-file infra/github-oidc.yaml \
  --stack-name capacity-planner-github \
  --region us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM
```

The workflow assumes `arn:aws:iam::518710148615:role/capacity-planner-github-deploy` (OIDC). That ARN is in `.github/workflows/deploy.yml`, not a GitHub secret.

Do not commit `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` into git.

After the workflow is on `master`/`main`, every merge deploys.

## Manual deploy

```bash
export AWS_CONFIG_FILE="$PWD/infra/aws-config"
aws sso login --profile capacity-planner
npm run deploy
```
