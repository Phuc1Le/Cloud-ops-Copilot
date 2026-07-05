#!/bin/bash
set -e
echo "Building..."
npm run build
echo "Zipping..."
cd dist && zip -r ../lambda-deploy.zip index.js && cd ..
echo "Done. Upload lambda-deploy.zip via the Lambda console: Code tab -> Upload from -> .zip file."

# CLI deploy is intentionally not automated here — it would require a long-lived
# access key for an admin-equivalent IAM user sitting on this machine. Uploading
# lambda-deploy.zip through the console instead uses your already-authenticated
# session, with no standing credential left behind.
#
# If deploys become frequent enough to want this automated, create a narrowly
# scoped deploy IAM user/role (lambda:UpdateFunctionCode + lambda:GetFunction on
# this function's ARN only) and use that here instead of an admin identity:
#
# aws lambda update-function-code \
#   --function-name cloud-ops-copilot \
#   --zip-file fileb://lambda-deploy.zip \
#   --profile your-scoped-deploy-profile