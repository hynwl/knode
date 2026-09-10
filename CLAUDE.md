# Claude Code Policy (Token Efficient)

Model & Subagent Execution Rules

## 1. Subagent Delegation Guidelines
- **Subagent Model Rule:** Whenever spawning a subagent for simple tasks (e.g., file search, directory traversal, running terminal commands, background log inspection), strictly use **Claude 4.5 Haiku**.
- **Main Model Reservation:** Reserve the primary model (**Sonnet**) strictly for main code logic implementation, complex refactoring, and direct response generation.

## 2. Subagent Spawning Constraint
- Do NOT spawn subagents unnecessarily.
- If target file paths are provided in the prompt (e.g., via `@` references), execute operations directly without initializing background search subagents.
