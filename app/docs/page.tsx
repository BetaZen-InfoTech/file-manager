export const dynamic = 'force-static';

export default function DocsPage() {
  return (
    <html lang="en">
      <head>
        <title>File Manager API docs</title>
        <link
          rel="stylesheet"
          href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, background: '#0b0b0c' }}>
        <div id="swagger-ui" />
        <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('load', () => {
                window.ui = SwaggerUIBundle({
                  url: '/api/v1/openapi',
                  dom_id: '#swagger-ui',
                  deepLinking: true,
                  presets: [SwaggerUIBundle.presets.apis]
                });
              });
            `
          }}
        />
      </body>
    </html>
  );
}
