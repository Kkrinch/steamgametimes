const { Telegraf } = require('telegraf')

const bot = new Telegraf("14481448:ABC_ASDAsdASDASD");
//bot.command("ping", (ctx) => {
//	ctx.telegram.sendMessage(ctx.message.chat.id, "It's working");
//})

bot.launch();

module.exports = bot
