import ReactMarkdown from "react-markdown";

// Renders Thom's responses as markdown. Custom components style each element
// against our dark theme — most importantly, links pop in new tabs and use
// the accent color.
//
// Note: in the Vite app, agent-served paths got rewritten through apiUrl()
// so they crossed origins. In Next.js we move /documents/{id} to a same-
// origin Route Handler in Phase 4, so plain hrefs work — no rewriting.

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline underline-offset-2"
          >
            {children}
          </a>
        ),
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h1 className="font-serif text-2xl mb-3 mt-1">{children}</h1>,
        h2: ({ children }) => <h2 className="font-serif text-xl mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="font-medium text-base mb-2 mt-3">{children}</h3>,
        strong: ({ children }) => <strong className="font-semibold text-ink-primary">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children, className }) => {
          const isBlock = className?.startsWith("language-");
          return isBlock ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="px-1.5 py-0.5 bg-bg-elevated text-ink-primary text-[0.9em] font-mono rounded">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-3 p-3 bg-bg-elevated rounded-lg overflow-x-auto font-mono text-sm">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-border-strong pl-4 my-3 text-ink-secondary italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-4 border-border-subtle" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
