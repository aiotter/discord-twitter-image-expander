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
  "https?://twitter.com/[^/\\s]+/status/([0-9]+)",
);

class CustomId {
  twitterStatusId?: string;
  discordMessageId?: string;
  constructor(str?: string) {
    if (str) [this.twitterStatusId, this.discordMessageId] = str.split("/");
  }
  toString() {
    return `${this.twitterStatusId}/${this.discordMessageId}`;
  }
}

function getImageUrls(message: DiscordenoMessage) {
  const twitterUrls = new Set<string>();
  message.embeds.forEach((embed) => {
    const twitterUrl = embed?.url?.match(twitterUrlRegex);
    if (twitterUrl) twitterUrls.add(twitterUrl[0]);
  });
  const imageUrls: { [key: string]: string[] } = {};
  for (const twitterUrl of twitterUrls) {
    const statusId = twitterUrl.match(twitterUrlRegex)?.[1] as string;
    const imageUrlsForStatusId = message.embeds
      .filter((e) => e?.url?.startsWith(twitterUrl) && e?.image)
      .map((e) => e.image?.url) as string[];
    imageUrls[statusId] = imageUrlsForStatusId;
  }
  return imageUrls;
}

async function replyToTwitterWithMultipleImages(message: DiscordenoMessage) {
  const imageUrlMap = getImageUrls(message);
  const customId = new CustomId();
  for (const [statusId, imageUrls] of Object.entries(imageUrlMap)) {
    customId.twitterStatusId = statusId;
    customId.discordMessageId = message.id.toString();
    if (imageUrls.length > 1) {
      const button: ButtonComponent = {
        type: DiscordMessageComponentTypes.Button,
        label: `Show all the images (${imageUrls.length})`,
        style: DiscordButtonStyles.Primary,
        customId: customId.toString(),
      };
      const row: ActionRow = {
        type: DiscordMessageComponentTypes.ActionRow,
        components: [button],
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
      const customId = new CustomId(
        interaction.message?.components?.[0]?.components?.[0].customId,
      );
      const message = await helpers.getMessage(
        BigInt(interaction.message?.channelId as string),
        BigInt(customId.discordMessageId as string),
      );
      const imageUrlMap = getImageUrls(message);
      const imageUrls = imageUrlMap[customId.twitterStatusId as string];
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
