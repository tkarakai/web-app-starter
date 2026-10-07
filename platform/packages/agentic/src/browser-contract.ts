/** Generated JSON contract. Run this package's generate:contracts script after schema changes. */
export const browserContracts = [
  {
    "name": "browser_readPage",
    "title": "Read live admin page",
    "description": "Read visible page text and controls with opaque control IDs. Excludes credential/security ceremonies. Offset pages the text; controlsOffset pages up to 40 controls. Requires an authenticated live WebMCP page.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "offset": {
          "default": 0,
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "controlsOffset": {
          "default": 0,
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "offset",
        "controlsOffset"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_navigate",
    "title": "Navigate admin page",
    "description": "Navigate to a relative protected admin path. Cannot open public authentication pages, the auth-only origin or an external site. Navigation discards current page state; respect unsaved work.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "maxLength": 1000
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_activate",
    "title": "Activate page control",
    "description": "Click a visible enabled button, link, tab, option or menu item by its control ID from readPage. Existing confirmation dialogs and native authorization still apply. Never click destructive confirmation without explicit user intent.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "controlId": {
          "type": "string",
          "maxLength": 50
        }
      },
      "required": [
        "controlId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_fill",
    "title": "Edit live form or search",
    "description": "Set a non-secret input, textarea or contenteditable value in the live page. This changes the draft/search only; saving requires its normal control. Password, token and security-ceremony controls are excluded.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "controlId": {
          "type": "string",
          "maxLength": 50
        },
        "value": {
          "type": "string",
          "maxLength": 50000
        }
      },
      "required": [
        "controlId",
        "value"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_select",
    "title": "Select form value",
    "description": "Choose an existing option in a native select control. For custom dropdowns use activate to open it and activate its visible option.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "controlId": {
          "type": "string",
          "maxLength": 50
        },
        "value": {
          "type": "string",
          "maxLength": 200
        }
      },
      "required": [
        "controlId",
        "value"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_toggle",
    "title": "Toggle page control",
    "description": "Set a checkbox or switch to the requested state using its existing UI behavior. Feature/security switches may have real consequences.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "controlId": {
          "type": "string",
          "maxLength": 50
        },
        "checked": {
          "type": "boolean"
        }
      },
      "required": [
        "controlId",
        "checked"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_scroll",
    "title": "Scroll admin page",
    "description": "Scroll the live admin page to a vertical pixel offset. readPage provides currently loaded data; use existing Load more controls to fetch additional rows.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "top": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1000000
        }
      },
      "required": [
        "top"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_reload",
    "title": "Reload admin page",
    "description": "Reload the current admin page. Unsaved drafts may be lost; require the user's intent.",
    "effect": "browser",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  }
] as const;
