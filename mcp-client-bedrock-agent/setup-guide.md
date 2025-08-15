# Setting Up Your Bedrock Agent for MCP Integration

This guide explains how to set up an Amazon Bedrock Agent to work with MCP servers through this client.

## 1. Create a Bedrock Agent

1. Go to the Amazon Bedrock console
2. Navigate to "Agents" and click "Create agent"
3. Provide a name and description for your agent
4. Select a foundation model (Claude models work well)
5. Configure agent settings as needed
6. Click "Create"

## 2. Create Action Groups for MCP Tools

For each group of related MCP tools, create an action group:

1. In your agent configuration, go to "Action groups"
2. Click "Add action group"
3. Name your action group (e.g., "MCPWeatherTools")
4. Select "OpenAPI schema" as the definition method
5. Create an OpenAPI schema that matches your MCP tools

### Correct OpenAPI Schema for Your Weather MCP Server

Create **one action group** called "WeatherTools" with this OpenAPI schema:

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Weather MCP Tools",
    "version": "1.0.0",
    "description": "National Weather Service tools via MCP"
  },
  "paths": {
    "/get-alerts": {
      "post": {
        "summary": "Get weather alerts for a state",
        "operationId": "get-alerts",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "state": {
                    "type": "string",
                    "description": "Two-letter state code (e.g. CA, NY)",
                    "pattern": "^[A-Z]{2}$"
                  }
                },
                "required": ["state"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Weather alerts for the state",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "alerts": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/get-forecast": {
      "post": {
        "summary": "Get weather forecast for coordinates",
        "operationId": "get-forecast",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "latitude": {
                    "type": "number",
                    "minimum": -90,
                    "maximum": 90,
                    "description": "Latitude of the location"
                  },
                  "longitude": {
                    "type": "number", 
                    "minimum": -180,
                    "maximum": 180,
                    "description": "Longitude of the location"
                  }
                },
                "required": ["latitude", "longitude"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Weather forecast for the coordinates",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "forecast": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## 3. Configure Agent Instructions

Add these instructions to your agent (this matches your actual setup):

```
You are a helpful weather assistant that can provide weather alerts and forecasts.

You have access to MCP (Model Context Protocol) tools through action groups:

get-alerts: Use this tool to get weather alerts for a US state
Required parameter: state (two-letter state code, e.g., CA, NY)

get-forecast: Use this tool to get weather forecast for a location
Required parameters: latitude and longitude (numeric coordinates)

MCP CONTEXT:
You can access MCP context data in the session attributes under the key "mcp_context". This contains valuable information that you should use when answering questions.

When responding to user queries about weather:
For state weather alerts, use the get-alerts tool with the appropriate state code.

For location forecasts, use the get-forecast tool with the latitude and longitude.

For any other weather-related questions, refer to TheWeatherGuide PDF from the knowledge base to provide accurate and detailed answers.

Always explain the weather information in a clear, concise manner.

If the user doesn't specify a location, ask them for one.

Example coordinates for major US cities:
New York City: 40.7128, -74.0060
Los Angeles: 34.0522, -118.2437
Chicago: 41.8781, -87.6298
Houston: 29.7604, -95.3698
Phoenix: 33.4484, -112.0740
```

## 4. Create an Agent Alias

1. In your agent configuration, go to "Aliases"
2. Click "Create alias"
3. Provide a name and description
4. Select the latest draft version of your agent
5. Click "Create"

## 5. Test with the MCP Client

Now you can use the MCP client to test your agent:

```bash
node build/index.js <path_to_mcp_server_script> <agent_id> <agent_alias_id>
```

## Troubleshooting

If your agent isn't using MCP tools correctly:

1. Check that your OpenAPI schemas match your MCP tool schemas
2. Verify that your agent instructions mention the MCP tools
3. Ensure your MCP server is providing the expected tools and context
4. Look at the agent trace in the client output for debugging information
