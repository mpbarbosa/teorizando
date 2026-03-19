# Copilot Instructions

## Repository Purpose

**teorizando** (Portuguese: "theorizing") is a personal knowledge base and notes repository. It stores exploratory tech notes, AI-generated research summaries, and documentation links — not executable code.

## Structure

- Root-level `.md` files: standalone tech exploration notes (AI-generated or manually written)
- `documentation/`: HTML pages that act as an index/portal, linking to external resources (e.g., Google Docs)
- `documentation/anotacoes.html`: main notes index page, links out to detailed documents

## Conventions

- Notes files use descriptive titles as filenames (e.g., `Best Tech Stack for Netflix Text Overlay.md`)
- HTML files in `documentation/` use a plain Bootstrap-ready structure (`<link href="css/style.css">`) — no build step required
- AI-generated content is tagged at the bottom: `AI-generated, for reference only`
- The project language mix is English (content) and Portuguese (naming/metadata)

## Adding Content

- New topic notes go in the root as `.md` files
- New documentation index entries go in `documentation/anotacoes.html` as `<li><a href="...">` list items
