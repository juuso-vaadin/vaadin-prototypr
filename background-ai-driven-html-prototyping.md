# AI-Driven HTML Prototyping and Custom Design Systems for Vaadin Applications

> **Context file for this repository.** Exported from the internal discussion paper of the same name (Claude Docs, 2026-11-26). It explains *why* this project exists. Where it differs from `SPEC.md`, `SPEC.md` wins for this project. An embedded chart from the original has been left out.

*Discussion paper for internal stakeholders. Status: exploration, no approach chosen yet.*

## 1. Why customers need this

Building software is slow and expensive. Seeing a UI before writing any logic is much cheaper, and that's why UX teams prototype. Until now, prototypes have usually been drawn in Figma.

We see customers wanting to replace that step with **AI-built HTML prototypes**. A stakeholder or developer writes a prompt, and an AI agent (for example Claude) produces a working HTML representation of a Vaadin UI. It's quicker to iterate on with an agent than a Figma file is.

The prototype isn't the final product. It's a stand-in for a Vaadin UI and gets **translated into Vaadin Flow (Java) code** later. The main users are stakeholders and developers. Prototypes are short-lived and focused on one design question at a time. They're not meant to be a maintained representation of the full application.

## 2. Why the design system matters

Generic AI design tools, such as Claude Design, already do reasonable work from scratch. If customers are going to buy this service from us, we have to do better than generic.

**Our value is in brownfield development.** The prototypes should match the customer's existing applications, not look like just any app. Without a design system, the AI falls back on patterns from its general training. With one, the design system acts as a **harness**: it defines which components, compositions, patterns and view templates the AI may use.

What this makes possible:

- **Starting close to reality.** Even when starting from a blank page, a prototype resembles the customer's existing application.
- **Adding features in context.** A user takes a screenshot of the existing application and gives it to an agent. The agent rebuilds it as an HTML prototype using the design system, and the user can then see a new feature added to the real UI.
- **Easier handoff to Flow.** Every building block in the prototype maps to something that already exists on the Vaadin Flow side.

The main thing to capture is the customer's own components, compositions and patterns. The visual style is one part of it.

## 3. Four approaches to defining the design system

We've trialled several ways to define the design system. They differ mainly in how much of it is **human-readable text** and how much is **code**.

### Approach 1: Traditional (docs website plus component codebase)

A documentation website written mainly for human readers such as UX designers, developers and content writers. It explains what each component is and when to use it, with code snippets, and comes with a codebase that holds the real component implementations.

### Approach 2: Agent-first markdown (tech-agnostic, text only)

Markdown files that describe components, their behaviour and appearance, with no code. They're still readable by humans but written mainly for agents. Because it's plain text, any AI tool can use it.

### Approach 3: Markdown plus HTML snippets

Approach 2 with generic HTML code examples added. These can use the real styles and possibly the real web components, but they're still stand-ins for the Vaadin Flow Java components. It could act as one source from which several stacks are derived, but it's less tech-agnostic than Approach 2: the HTML follows Vaadin's styles and web components, and we'd prefer to keep it aligned with Vaadin.

### Approach 4: Code-first Vaadin Flow project

A new Vaadin Flow project that implements all the styles, Java classes and components needed to build the customer's applications. The deliverable is a repository, currently without usage documentation. **We've already validated this to some extent.** It's tied to Vaadin Flow, which is strategically good for us, since Flow is our framework and the stack we want customers to use.

*Open question:* how should usage guidance be added? Options include Javadoc in the classes or markdown files in the repository that describe intended use cases and steer agents.

### Comparison

|  | 1. Traditional | 2. Markdown only | 3. Markdown + HTML | 4. Flow code-first |
| --- | --- | --- | --- | --- |
| Balance of content | Mostly text, some code | Almost all text | Text and code in balance | Almost all code |
| Main reader | Humans | Agents (human-readable) | Agents | Agents and developers |
| Tech-agnostic | Partly | Yes | Partly (aligned with Vaadin) | No (Vaadin Flow) |
| Distance to Flow code | Medium | Far | Medium | Closest |
| Maturity | Familiar model | Trialled | Trialled | Partly validated |

### Architecture overview of the building blocks

In every approach, the design system feeds the AI agent, the agent builds an HTML prototype, and the prototype is translated into Vaadin Flow. What changes is the mix of text and code in the design system.

### Delivery channels

**Delivery is a separate choice from the approach.** The approach decides what the design system contains; the channel decides who can reach it and how. Any approach can use any channel.

| Channel | Main audience | Privacy level | Notes |
| --- | --- | --- | --- |
| Public website | Humans | Public or internal | The most likely way people read the design system. |
| Public website with llms.txt | AI agents | Public or internal | An agent-readable index at the website's URL: a markdown file with short guidance and links to markdown versions of the pages. It's a community proposal, not a formal standard. Agents use the same site humans read, with no connector needed. |
| MCP server | AI agents only | Public, internal or local | The most natural connection for an agent, but humans can't read it. |
| Repository | Developers and agents | Public, internal or local | A developer can read it directly. It's a less natural connection for an agent than MCP. |
| Agent skill as a library | AI agents | Internal or local | The skill holds all the documentation itself. It's both the library and the endpoint, so the agent needs nothing else. |
| Agent skill as a pointer | AI agents | Internal or local | A lightweight connector that tells the agent where to find the sources, such as the website, llms.txt, an MCP server or a repository. |

**Privacy depends on the customer.** Some customers want it public. Others need everything to run locally or inside their own network.

These channels aren't mutually exclusive. One customer might combine a public website, an MCP server and a pointer skill.

## 4. Prototyping setups tried so far

We've built two working setups for producing the HTML prototypes. Both load the real Vaadin web components and the Aura theme. **The main difference is collaboration, not the tech.**

**Setup A: boilerplate repository (local, any agent).** A GitHub repo with a basic index.html that loads the Vaadin web components and the Aura theme from the esm.sh CDN. You run it in your IDE and let its agent edit the prototype. Each new version is a file you send to the customer yourself, so the back-and-forth Figma offers is lost.

**Setup B: Claude skill (claude.ai artifact).** Available to everyone in our Claude workspace. claude.ai can't reach every CDN, so the skill bundles the components and theme into a self-contained artifact. Start a chat, invoke the skill, and share the result as a link that customers can comment on.

|  | A: Boilerplate repo | B: Claude skill |
| --- | --- | --- |
| Setup | Clone and run locally | None |
| Agent | Any (for example, the IDE agent) | Claude on claude.ai |
| How components load | esm.sh CDN | Bundled in the skill and artifact |
| Output | index.html file | Self-contained artifact |
| Sharing new versions | Send a new file each time | Share a link |
| Collaboration | None built in | Comments on the artifact |

**Implication for customer delivery:** how customers review, comment on and iterate on prototypes has to be part of the offering, not only how prototypes are generated.

## 5. Principles that apply to every approach

- **Prototypes are throwaway.** Each prototype covers one focused piece of design, not the whole application: a new feature in an existing view, a new view, or a workflow across a few views. Once it has served its purpose, it's discarded, and the process repeats for the next piece.
- **The handoff to Flow is the key test.** Whatever the approach, we need to check how well prototypes convert into Vaadin Flow code. The closer the prototype is to the final Flow code, the better the result.
- **Use the real things.** Prototypes should load the real Lumo, Aura or Vaadin base styles so the CSS is compatible with Flow, and they should use the actual Vaadin web components, not imitations.
- **No single approach for everyone.** This is a repeatable service delivered to several customers with different goals. Customers who use only Vaadin Flow suit the Flow-focused approaches. Others want a tech-agnostic setup.
- **Sharing should be as easy as in Figma.** Sending index.html files by email or chat doesn't work: every new version is another file with another name. The bar is Figma-like collaboration. Not everyone needs to edit, but anyone should be able to open the latest prototype from a single link. Useful extras in the preview: commenting, switching between light and dark themes, and generic testing tools such as checking responsiveness.
- **Versioning and branching.** It should be easy to create a new version, look back at earlier ones, and clone a prototype for another experiment. Branch could be added whenever you want to try another direction. The versions and branches help you compare the alternatives and decide.

## 6. Open questions and next steps

- What are the real pros and cons of each approach in customer projects?
- How do we add usage documentation to Approach 4: Javadoc, markdown or both?
- How should we measure prototype-to-Flow translation quality across the approaches?
- What's the best way to capture a customer's existing patterns, for example from screenshots, existing code or existing docs?
- Which mix of delivery channels fits each customer? And which prototyping setup do we offer each customer: the local boilerplate repo, the Claude skill, or both?
- How should existing Figma assets be used? Designers will probably keep using Figma to some extent, and customers may already have definitions there. Figma could feed the design system definition phase, but it shouldn't be part of generating the HTML prototypes.

**Proposed next step:** run the same prototyping and Flow-translation task with each approach on one pilot customer application, and compare the results.

## Sources

- [State of AI in design systems: techniques](https://state-of-ai-in-design-systems.netlify.app/techniques)
- [The /llms.txt proposal](https://llmstxt.org/)
