#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK_NAME:-capacity-planner}"
TEMPLATE="$ROOT/infra/cloudfront.yaml"
PROFILE="${AWS_PROFILE:-}"

if [ -z "${GITHUB_ACTIONS:-}" ] && [ -z "$PROFILE" ]; then
  export AWS_CONFIG_FILE="${AWS_CONFIG_FILE:-$ROOT/infra/aws-config}"
  PROFILE="capacity-planner"
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is not installed. Install it with: brew install awscli"
  exit 1
fi

aws_cli() {
  if [ -n "$PROFILE" ]; then
    aws --profile "$PROFILE" "$@"
  else
    aws "$@"
  fi
}

echo "Using profile=${PROFILE:-<(default/OIDC)} region=$REGION stack=$STACK"
aws_cli sts get-caller-identity --region "$REGION" >/dev/null

echo "Building the app..."
npm run build

echo "Updating CloudFront function capacity-planner..."
FN_ETAG="$(aws_cli cloudfront describe-function --name capacity-planner --query ETag --output text)"
PUBLISH_ETAG="$(aws_cli cloudfront update-function \
  --name capacity-planner \
  --if-match "$FN_ETAG" \
  --function-config '{"Comment":"SPA routing for Capacity Planner","Runtime":"cloudfront-js-2.0"}' \
  --function-code "fileb://${ROOT}/infra/spa-rewrite.js" \
  --query ETag \
  --output text)"
aws_cli cloudfront publish-function --name capacity-planner --if-match "$PUBLISH_ETAG" >/dev/null
echo "Published CloudFront function capacity-planner (LIVE)."

echo "Deploying CloudFormation stack..."
aws_cli cloudformation deploy \
  --template-file "$TEMPLATE" \
  --stack-name "$STACK" \
  --region "$REGION" \
  --no-fail-on-empty-changeset

BUCKET="$(aws_cli cloudformation describe-stacks \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)"

DIST_ID="$(aws_cli cloudformation describe-stacks \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)"

URL="$(aws_cli cloudformation describe-stacks \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" \
  --output text)"

echo "Uploading hashed assets..."
aws_cli s3 sync "$ROOT/dist" "s3://$BUCKET" \
  --region "$REGION" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html"

echo "Uploading index.html..."
aws_cli s3 cp "$ROOT/dist/index.html" "s3://$BUCKET/index.html" \
  --region "$REGION" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

echo "Invalidating CloudFront..."
aws_cli cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --region "$REGION" \
  --query "Invalidation.Id" \
  --output text

echo
echo "Published: $URL"
