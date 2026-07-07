# Context

## Terms

### Primitive proof
A live Clay verification that one low-level operation works, such as creating a source, importing rows, or reading table metadata. Primitive proof is not evidence that a production-style Clay workbook has been built.

### Real Clay workbook
A Clay workbook that matches the operator's reference examples: populated tables, configured enrichment/action fields, model choices, prompts, JSON schemas, output fields, run conditions, provider integrations, views, and live run/readback evidence.

### Workbook parity
The standard for Clay CLI workflow building where a generated workbook is compared against known-good Clay workbooks and must match their functional structure, not just row counts or field names.

### Configured action field
An action field whose Clay readback includes the real action key/package, input bindings, optional auth account reference, model/use-case settings, prompt text, output schema, run settings, and conditional run formula.

### Output schema
The JSON schema or field-output mapping configured for an AI/action field. For AI columns, this includes JSON Schema output format when used in the Clay UI.

### Run condition
A Clay formula that determines whether an action should run on a row, such as only running when a LinkedIn URL is present or an upstream verification status is valid.

### Live readback
A fresh Clay API read after a mutation or run. Live readback is the source of truth; command responses, import responses, and offline specs are not proof by themselves.

### Parity fixture
A redacted manifest extracted from a known-good Clay workbook and used as the reference shape for workbook parity checks.
