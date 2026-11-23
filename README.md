# Fast Note

Fast Note is a private Telegram bot that saves messages and attachments to a Notion page. It adds one bullet per message under **Quick notes**, newest first, with a Moscow timestamp and any available forward or reply context. The bot replies only when a save fails or an attachment is missing.

## Setup

1. Create a bot in [@BotFather](https://t.me/BotFather) and get its Serverless CLI access token.
2. Create a [Notion internal integration](https://developers.notion.com/guides/notion-api/quick-start) with **Read content** and **Insert content** permissions. Connect it to the destination page and make sure that page has a top-level **Quick notes** heading.
3. Install dependencies and copy the example config.

   ```sh
   npm ci
   cp config.example.js tgcloud/lib/config_local.js
   ```

4. Set `ownerId` to your numeric Telegram user ID, `notionToken` to your integration token, and `pageId` to the destination Notion page ID. The local config is ignored by Git and uploaded as a server-side module when you deploy.
5. Link and deploy the bot.

   ```sh
   npx tgcloud login
   npm run deploy
   ```

6. Send the bot a private message and check **Quick notes** in Notion.
