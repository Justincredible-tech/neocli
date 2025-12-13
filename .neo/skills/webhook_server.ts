/* NEO_SKILL_META
{
  "name": "webhook_server",
  "description": "Starts a temporary HTTP server to capture incoming webhooks for testing.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "port": { "type": "number", "default": 3000 },
      "durationSeconds": { "type": "number", "default": 60, "description": "How long to listen before shutting down" }
    }
  }
}
NEO_SKILL_META */

import express from 'express';
import bodyParser from 'body-parser';
import chalk from 'chalk';

export async function run(args: { port?: number; durationSeconds?: number }) {
  const port = args.port || 3000;
  const timeout = (args.durationSeconds || 60) * 1000;

  return new Promise((resolve) => {
    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    const server = app.listen(port, () => {
      console.log(chalk.green(`\n[Listener] Active on port ${port}. Waiting for payloads...`));
      console.log(`(Will auto-close in ${timeout / 1000} seconds)`);
    });

    // Capture Logic
    app.all('*', (req, res) => {
      console.log(chalk.yellow(`\n[Incoming] ${req.method} ${req.url}`));
      console.log(chalk.dim('Headers:'), JSON.stringify(req.headers, null, 2));
      console.log(chalk.cyan('Body:'), JSON.stringify(req.body, null, 2));
      
      res.status(200).send({ status: 'Received by NeoCLI' });
    });

    // Auto-Shutdown
    setTimeout(() => {
      server.close(() => {
        resolve(`Listener closed after ${timeout / 1000}s.`);
      });
    }, timeout);
  });
}