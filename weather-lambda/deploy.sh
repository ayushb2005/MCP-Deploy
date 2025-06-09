#!/bin/bash

# Build and package the Lambda function
npm run package

# # Check if the Lambda function already exists
# FUNCTION_EXISTS=$(aws lambda list-functions --query "Functions[?FunctionName=='weather-mcp-server'].FunctionName" --output text)

# if [ -z "$FUNCTION_EXISTS" ]; then
#   echo "Creating new Lambda function..."
#   aws lambda create-function \
#     --function-name weather-mcp-server \
#     --runtime nodejs18.x \
#     --handler index.handler \
#     --zip-file fileb://weather-lambda.zip \
#     --role $AWS_LAMBDA_ROLE_ARN \
#     --timeout 30 \
#     --memory-size 256
# else
#   echo "Updating existing Lambda function..."
#   aws lambda update-function-code \
#     --function-name weather-mcp-server \
#     --zip-file fileb://weather-lambda.zip
# fi

# # Get the Lambda function ARN
# LAMBDA_ARN=$(aws lambda get-function --function-name weather-mcp-server --query 'Configuration.FunctionArn' --output text)

# echo "Lambda function ARN: $LAMBDA_ARN"

# # Check if API Gateway exists
# API_ID=$(aws apigateway get-rest-apis --query "items[?name=='weather-mcp-api'].id" --output text)

# if [ -z "$API_ID" ]; then
#   echo "Creating new API Gateway..."
#   API_ID=$(aws apigateway create-rest-api --name weather-mcp-api --query 'id' --output text)
  
#   # Get the root resource ID
#   ROOT_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --query 'items[?path==`/`].id' --output text)
  
#   # Create /mcp resource
#   MCP_RESOURCE_ID=$(aws apigateway create-resource --rest-api-id $API_ID --parent-id $ROOT_RESOURCE_ID --path-part mcp --query 'id' --output text)
  
#   # Create POST method
#   aws apigateway put-method \
#     --rest-api-id $API_ID \
#     --resource-id $MCP_RESOURCE_ID \
#     --http-method POST \
#     --authorization-type NONE
  
#   # Create GET method
#   aws apigateway put-method \
#     --rest-api-id $API_ID \
#     --resource-id $MCP_RESOURCE_ID \
#     --http-method GET \
#     --authorization-type NONE
  
#   # Create DELETE method
#   aws apigateway put-method \
#     --rest-api-id $API_ID \
#     --resource-id $MCP_RESOURCE_ID \
#     --http-method DELETE \
#     --authorization-type NONE
  
#   # Set up Lambda integration for POST
#   aws apigateway put-integration \
#     --rest-api-id $API_ID \
#     --resource-id $MCP_RESOURCE_ID \
#     --http-method POST \
#     --type AWS_PROXY \
#     --integration-http-method POST \
#     --uri arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations
  
#   # Set up Lambda integration for GET
#   aws apigateway put-integration \
#     --rest-api-id $API_ID \
#     --resource-id $MCP_RESOURCE_ID \
#     --http-method GET \
#     --type AWS_PROXY \
#     --integration-http-method POST \
#     --uri arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations
  
#   # Set up Lambda integration for DELETE
#   aws apigateway put-integration \
#     --rest-api-id $API_ID \
#     --resource-id $MCP_RESOURCE_ID \
#     --http-method DELETE \
#     --type AWS_PROXY \
#     --integration-http-method POST \
#     --uri arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations
  
#   # Add Lambda permission for API Gateway
#   aws lambda add-permission \
#     --function-name weather-mcp-server \
#     --statement-id apigateway-post \
#     --action lambda:InvokeFunction \
#     --principal apigateway.amazonaws.com \
#     --source-arn "arn:aws:execute-api:$AWS_REGION:$AWS_ACCOUNT_ID:$API_ID/*/POST/mcp"
  
#   aws lambda add-permission \
#     --function-name weather-mcp-server \
#     --statement-id apigateway-get \
#     --action lambda:InvokeFunction \
#     --principal apigateway.amazonaws.com \
#     --source-arn "arn:aws:execute-api:$AWS_REGION:$AWS_ACCOUNT_ID:$API_ID/*/GET/mcp"
  
#   aws lambda add-permission \
#     --function-name weather-mcp-server \
#     --statement-id apigateway-delete \
#     --action lambda:InvokeFunction \
#     --principal apigateway.amazonaws.com \
#     --source-arn "arn:aws:execute-api:$AWS_REGION:$AWS_ACCOUNT_ID:$API_ID/*/DELETE/mcp"
  
#   # Deploy the API
#   aws apigateway create-deployment \
#     --rest-api-id $API_ID \
#     --stage-name prod
# else
#   echo "API Gateway already exists with ID: $API_ID"
# fi

# # Get the API Gateway URL
# API_URL="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/prod/mcp"

# echo "Deployment complete!"
# echo "API Gateway URL: $API_URL"
# echo ""
# echo "Update your client's .env file with:"
# echo "MCP_SERVER_URL=https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/prod"
