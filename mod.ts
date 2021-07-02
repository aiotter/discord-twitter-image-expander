import {
  ActionRow,
  ButtonComponent,
  camelize,
  CreateMessage,
  DiscordButtonStyles,
  DiscordenoMessage,
  DiscordInteractionResponseTypes,
  DiscordInteractionTypes,
  DiscordMessageComponentTypes,
  helpers,
  Message,
  startBot,
} from "https://deno.land/x/discordeno@11.2.0/mod.ts";

const twitterUrlRegex = new RegExp(
  "https?://twitter.com/([^/\\s]+)/status/([0-9]+)",
);

class CustomId {
  twitterUserName: string;
  twitterStatusId: string;
  discordMessageId: string;
  constructor(
    twitterUserName: string,
    twitterStatusId: string,
    discordMessageId: string,
  ) {
    this.twitterUserName = twitterUserName;
    this.twitterStatusId = twitterStatusId;
    this.discordMessageId = discordMessageId;
  }
  toString() {
    return `${this.twitterUserName}/${this.twitterStatusId}/${this.discordMessageId}`;
  }
  static fromString(str: string) {
    const [twitterUserName, twitterStatusId, discordMessageId] = str.split("/");
    return new this(twitterUserName, twitterStatusId, discordMessageId);
  }
}

function getImageUrlMap(message: DiscordenoMessage) {
  const twitterUrls = new Set<string>();
  message.embeds.forEach((embed) => {
    const twitterUrl = embed?.url?.match(twitterUrlRegex);
    if (twitterUrl) twitterUrls.add(twitterUrl[0]);
  });
  const imageUrls: { [key: string]: string[] } = {};
  for (const twitterUrl of twitterUrls) {
    const match = twitterUrl.match(twitterUrlRegex) as RegExpMatchArray;
    const [_statusUrl, userId, statusId] = match;
    const imageUrlsForStatusId = message.embeds
      .filter((e) => e?.url?.startsWith(twitterUrl) && e?.image)
      .map((e) => e.image?.url) as string[];
    imageUrls[`${userId}/${statusId}`] = imageUrlsForStatusId;
  }
  return imageUrls;
}

async function replyToTwitterWithMultipleImages(message: DiscordenoMessage) {
  const imageUrlMap = getImageUrlMap(message);
  for (const [tweetId, imageUrls] of Object.entries(imageUrlMap)) {
    const [twitterUserName, twitterStatusId] = tweetId.split("/");
    const customId = new CustomId(twitterUserName, twitterStatusId, message.id.toString());
    if (imageUrls.length > 1) {
      const showImagesButton: ButtonComponent = {
        type: DiscordMessageComponentTypes.Button,
        label: `Show all the images (${imageUrls.length})`,
        style: DiscordButtonStyles.Primary,
        customId: customId.toString(),
      };
      const openTwitterButton: ButtonComponent = {
        type: DiscordMessageComponentTypes.Button,
        label: "Open App",
        style: DiscordButtonStyles.Link,
        url:
          `https://twitter.com/${customId.twitterUserName}/status/${customId.twitterStatusId}`,
      };
      const row: ActionRow = {
        type: DiscordMessageComponentTypes.ActionRow,
        components: [showImagesButton, openTwitterButton],
      };
      let sendingMessage: CreateMessage;
      if (Object.keys(imageUrlMap).length > 1) {
        sendingMessage = {
          // Send thumbnail image if more than one tweet url is included
          // in the original message
          content: imageUrls[0].replace(/(:[^/]*?)?$/, ":thumb"),
          components: [row],
        };
      } else {
        sendingMessage = {
          file: {
            blob: new Blob([await Deno.readFile("spacer.png")], {
              type: "image/png",
            }),
            name: "spacer.png",
          },
          components: [row],
        };
      }
      message.reply(sendingMessage, false);
    }
  }
}

startBot({
  token: Deno.env.get("TOKEN") as string,
  intents: ["Guilds", "GuildMessages"],
  eventHandlers: {
    ready() {
      console.log("Successfully connected to gateway");
    },

    messageCreate(message) {
      if (message.embeds.length !== 0) {
        replyToTwitterWithMultipleImages(message);
      }
    },

    async interactionCreate(interaction) {
      if (interaction.type !== DiscordInteractionTypes.MessageComponent) return;
      const rawCustomId =
        interaction.message?.components?.[0]?.components?.[0].customId;
      if (!rawCustomId) return;
      const customId = CustomId.fromString(rawCustomId);
      const message = await helpers.getMessage(
        BigInt(interaction.message?.channelId as string),
        BigInt(customId.discordMessageId as string),
      );
      const imageUrlMap = getImageUrlMap(message);
      const imageUrls = imageUrlMap[`${customId.twitterUserName}/${customId.twitterStatusId}`];
      helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: DiscordInteractionResponseTypes.ChannelMessageWithSource,
        private: true,
        data: { content: imageUrls.join("\n") },
      });
    },

    async raw(data) {
      data = camelize(data);
      if (data.t === "MESSAGE_UPDATE") {
        // embed added by discord has no editedTimestamp
        const partialMessage = data.d as Message;
        if (partialMessage.editedTimestamp) return;

        try {
          const message = await helpers.getMessage(
            BigInt(partialMessage.channelId),
            BigInt(partialMessage.id),
          );
          replyToTwitterWithMultipleImages(message);
        } catch (error) {
          console.error(error);
        }
      }
    },
  },
});
