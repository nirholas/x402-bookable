/**
 * Per-route request/response schemas published in the x402 402 challenge.
 *
 * The x402scan discovery audit reads `accepts[0].outputSchema.input` and
 * `accepts[0].outputSchema.output` from the *runtime* 402 body, and runtime
 * behaviour is authoritative — so these must not contradict openapi.json.
 * They are generated from `public/openapi.json` ($refs inlined) and keyed
 * exactly like the paywall route map, so they can be spread straight into a
 * route declaration.
 *
 * Regenerate after editing openapi.json rather than hand-editing.
 *
 * `input` follows the x402 Bazaar convention: `{ type: "http", method, ... }`
 * with `queryParams` for GET routes and `bodyType`/`bodyFields` for routes
 * that take a JSON body. `output` is the 200 response schema.
 */

export type RouteSchema = {
  outputSchema: {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  };
};

export const ROUTE_SCHEMAS = {
  "GET /slots": {
    outputSchema: {
      input: {
        type: "http",
        method: "GET",
        queryParams: {
          service: {
            type: "string",
            description: "Service id; omit for every service."
          },
          date: {
            type: "string",
            format: "date"
          },
          days: {
            type: "integer",
            minimum: 1
          }
        }
      },
      output: {
        type: "object",
        properties: {
          provider: {
            type: "object"
          },
          slotMinutes: {
            type: "integer"
          },
          cancelPolicy: {
            type: "object",
            properties: {
              holdPrice: {
                type: "string",
                example: "$0.01"
              },
              freeCancellationHours: {
                type: "integer",
                example: 12
              },
              description: {
                type: "string"
              }
            }
          },
          generatedAt: {
            type: "string",
            format: "date-time"
          },
          services: {
            type: "array",
            items: {
              type: "object",
              properties: {
                serviceId: {
                  type: "string"
                },
                name: {
                  type: "string"
                },
                durationMinutes: {
                  type: "integer"
                },
                mode: {
                  type: "string",
                  enum: [
                    "video",
                    "in-person",
                    "phone"
                  ]
                },
                description: {
                  type: "string"
                },
                openSlots: {
                  type: "integer"
                },
                slots: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: {
                        type: "string",
                        format: "date"
                      },
                      time: {
                        type: "string",
                        example: "09:00"
                      },
                      endsAt: {
                        type: "string",
                        example: "09:30"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
    },
  },
  "POST /appointments": {
    outputSchema: {
      input: {
        type: "http",
        method: "POST",
        bodyType: "json",
        bodyFields: {
          service: {
            type: "string",
            example: "consult-30"
          },
          date: {
            type: "string",
            format: "date"
          },
          time: {
            type: "string",
            example: "09:00"
          },
          name: {
            type: "string"
          },
          email: {
            type: "string",
            format: "email"
          },
          notes: {
            type: "string"
          }
        },
        required: [
          "service",
          "date",
          "time",
          "name"
        ]
      },
      output: {
        type: "object",
        description: "The purchased artifact, returned in the 200 body of POST /appointments.",
        properties: {
          appointmentId: {
            type: "string"
          },
          status: {
            type: "string",
            enum: [
              "confirmed"
            ]
          },
          provider: {
            type: "string"
          },
          service: {
            type: "object"
          },
          time: {
            type: "string"
          },
          endsAt: {
            type: "string"
          },
          name: {
            type: "string"
          },
          email: {
            type: "string"
          },
          location: {
            type: "string"
          },
          meetingLink: {
            type: "string"
          },
          cancelPolicy: {
            type: "object",
            properties: {
              holdPrice: {
                type: "string",
                example: "$0.01"
              },
              freeCancellationHours: {
                type: "integer",
                example: 12
              },
              description: {
                type: "string"
              }
            }
          },
          cancelToken: {
            type: "string"
          },
          cancelEndpoint: {
            type: "string"
          },
          ledgerEntry: {
            type: "object",
            properties: {
              entryId: {
                type: "string"
              },
              appointmentId: {
                type: "string"
              },
              kind: {
                type: "string",
                enum: [
                  "hold",
                  "refund",
                  "forfeit"
                ]
              },
              amount: {
                type: "string"
              },
              wallet: {
                type: "string"
              },
              reason: {
                type: "string"
              },
              at: {
                type: "string",
                format: "date-time"
              }
            }
          },
          ics: {
            type: "string",
            description: "base64-encoded RFC 5545 calendar invite"
          },
          signature: {
            type: "string"
          },
          createdAt: {
            type: "string",
            format: "date-time"
          }
        }
      },
    },
  },
} satisfies Record<string, RouteSchema>;
