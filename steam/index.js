const clientBuilder = require("./config")
const bot = require("./telegram")
const { Telegraf, Markup, Extra } = require("telegraf")
const process = require("process")

const JOHNNY = 592593104 // Telegram ID
const profile_link = "https://steamcommunity.com/profiles/" // Base url for steam account
const max_accounts_per_page = 5 // Amount of accounts per page for telegram bot

const StormDB = require("stormdb")

process.on("uncaughtException", function (err) {
	console.log("Caught exception: ", err)
})

const engine = new StormDB.localFileEngine("./db.stormdb")
const db = new StormDB(engine)

db.default({ users: [592593104], accounts: [] })
//db.save()

/*
	HELPER FUNCS
*/

// Convert input to id and check if user has access
let HasAccess = function(input)
{
	let user = typeof(input) == "number" && input || input.message.from.id
	let access = db.state.users.includes(user)
	return {access:access, id:user}
}

// Easy function for telegram bot to check access
let CheckAccess = function(ctx)
{
	let {access, id} = HasAccess(ctx)
	if (!access) {
		ctx.replyWithHTML("Здравствуйте. <b>У вас нету доступа к функционалу бота</b>\n<b>Ваш ID:</b> <code>" + String(id) + "</code>.\n\nPowered by @karlend / johnny.systems")
		return
	}
	return true
}

// Parse user"s accounts
let ParseAccounts = function(id)
{
	let accounts = []
	for (let client of clientArray) {
		if (client.owner != id) {
			continue
		}
		accounts.push(client)
	}
	return accounts
}

// Used to convery user accounts list to list of 5
let GeneratePage = function(accounts, page = 1)
{
	return accounts.slice((page - 1) * max_accounts_per_page, page * max_accounts_per_page)
}

// Used to add few more buttons in account list
let GenerateArrowButtons = function(page = 1)
{
	return [Markup.button.callback("<", "accounts_prev"), Markup.button.callback(String(page), "page_number"), Markup.button.callback(">", "accounts_next")]
}

// Geretating buttons to select account
let GenerateAccountsButtons = function(user_accounts)
{
	let markup_list = []
	for (let client of user_accounts) {
		markup_list.push(
			[
				Markup.button.callback((client.prefix || "") + client.name, "::" + client.login)
			]
		)
	}
	return markup_list
}

// Function to find account by name/login and TLG ID
let FindAccount = function(name, id)
{
	for (let client of clientArray) {
		if (client.owner != id) {
			continue
		}
		if (/*client.name != name && */client.login != name) {
			continue
		}
		return client
	}
}

let GenerateAccountInfo = function(account)
{
	let limits = "Нету"
	if (account.limitations && account.limitations.length > 0) {
		limits = account.limitations.join(", ")
	}
	let bans = "Нету"
	if (account.bans && account.bans.length > 0) {
		bans = account.bans.join(", ")
	}
	return `Имя в боте: <code>${account.name || "unknown"}</code>
Статус: <code>${account.status || "unknown"}</code>
Имя в Steam: <a href="${profile_link}${account.steamid || "unknown"}">${account.steam_name || "unknown"}</a>
Баланс: <code>${account.GetBalance && account.GetBalance() || "unknown"}</code>
Кол-во игр: <code>${account.game_list.length || "unknown"}</code>
Лимиты: <code>${limits}</code>
Баны: <code>${bans}</code>
Авторизаций: <code>${account.authedCount || "0"}</code>
Игр на бусте: <code>${account.games && account.games.length || "Все"}</code>`
}

/*
	INIT ACCOUNTS
*/

let clientArray = []

let RegisterAccount = function(config) {
	let client = clientBuilder.execute(config)
	client.Notify = function(text) {
		bot.telegram.sendMessage(client.owner, text, { parse_mode: "HTML" }) // Registered function to notify user from every file
	}
	client.doLogin()
	clientArray.push(client)
}

for (let config of db.state.accounts) {
	RegisterAccount(config)
}
console.log("Running " + clientArray.length + " bots.")

/*
	TELEGRAM BOT
*/


bot.command("start", (ctx) => {
	if (!CheckAccess(ctx)) return
	ctx.replyWithHTML("Здравствуйте. <b>У вас есть доступ к боту</b>.\nДля добавления аккаунта используйте /add, после чего следуйте инструкции.\nУправление аккаунтами - /panel\n\n<b>Проблемы?</b> Сообщите @karlend")
})

// ACCOUNT LIST

bot.command(["panel", "accounts"], (ctx) => {
	if (!CheckAccess(ctx)) return
	let user = ctx.message.from.id
	let user_accounts = ParseAccounts(user)
	user_accounts = GeneratePage(user_accounts)

	let markup_list = GenerateAccountsButtons(user_accounts)
	markup_list.push(GenerateArrowButtons())

	ctx.replyWithHTML(
		"<b>Управление аккаунтами:</b>",
		Markup.inlineKeyboard(markup_list)
	)
})

bot.action(["accounts_prev", "accounts_next", "page_number"], (ctx) => {
	let query = ctx.update.callback_query
	let user = query.from.id
	if (!HasAccess(user))
	{
		ctx.answerCbQuery("У вас нету доступа к боту")
		return
	}
	let inline = query.message.reply_markup.inline_keyboard
	let page = Number(inline[inline.length - 1][1].text) || 1 // i don"t want to store a lot of data for different messages. Let telegram make it )

	let input = ctx.match.input
	let add = input == "accounts_next" && 1 || -1
	let new_page = input == "page_number" && 1 || (page + add)

	if (page == new_page || new_page < 1) {
		return ctx.answerCbQuery()// same/zero page, same context in tlg = error
	}

	let user_accounts = ParseAccounts(user)
	user_accounts = GeneratePage(user_accounts, new_page)

	let markup_list = GenerateAccountsButtons(user_accounts)
	markup_list.push(GenerateArrowButtons(new_page))
	markup_list = {inline_keyboard:markup_list} // telegraf issue, Markup.inlineKeyboard isn"t working

	try {
		ctx.editMessageReplyMarkup(markup_list)
	} catch(e) {
		ctx.answerCbQuery("Не смог обновить сообщение")
	}
})

// ACCOUNT LIST END

// ADD ACCOUNT

let add_steps = [
	{
		text:"Введите <b>имя аккаунта</b> ( оно будет использоваться только в боте для понимания, что это за аккаунт.",
		name:"name",
		check:function(text)
		{
			if (text.includes(" ") || text.includes("\n"))
			{
				return "Имя не может соддержать пробелы"
			}
			if (text.length > 30)
			{
				return "Имя слишком длинное"
			}
		}
	},
	{
		text:"Введите <b>логин аккаунта</b> ( да, тот самый логин Steam ).",
		name:"login",
		check:function(text)
		{
			if (text.length > 30)
			{
				return "Логин слишком длинный"
			}
		}
	},
	{
		text:"Введите <b>пароль аккаунта</b> ( ну, к нему я точно не полезу, увы, моя репутация мне дороже ).",
		name:"password",
		check:function(text)
		{
			if (text.length > 64)
			{
				return "Пароль слишком длинный"
			}
		}
	},
	{
		text:"А теперь введите Shared Secret\n( это текст, который используется для генерации кодов авторизации )\n( чаще всего люди используют https://github.com/Jessecar96/SteamDesktopAuthenticator для этого ). Если же вы не используете мобильный аутентификатор - введите <code>skip</code>",
		name:"shared_secret",
		check:function(text)
		{
			if (text.length > 64)
			{
				return "Shared Secret слишком длинный"
			}
		}
	},
	{
		text:"Вроде всё идёт нормально ( ну, я просто ещё не проверял, ха-ха ). Теперь через пробел введите ID игр Steam, которые хочешь бустить ( если ты хочешь, чтобы каждых 4 часа игры менялись - введите <code>skip</code> ).",
		name:"games",
		check:function(text)
		{
			if (text == "skip")
			{
				return
			}
			let games = text.split(" ")
			games.forEach(function(value, index) {
				let game = Number(value)
				if (isNaN(game)) {
					return "<b>Игра должна быть указана числом</b>"
				}
			})
			if (games.length > 32) {
				return "<b>Лимит - 32 игры</b> ( указано" + String(games.length) + " )"
			}
		}
	},
]

let accounts_add = {
	// [id]: {stage:0, name:name, login:login, password:password, shared_secret:shared_secret, games:games}
}

let AddAccount = function(id, ctx)
{
	let data = accounts_add[id]
	if (!data) return
	if ((data.stage + 1) != add_steps.length)
	{
		if (ctx) ctx.replyWithHTML("Произошла ошибка")
		delete accounts_add[id]
		return
	}

	let config = {
		name: data.name,
		login: data.login,
		password: data.password,
		owner: id
	}
	if (data.shared_secret != "skip")
	{
		config.sharedSecret = data.shared_secret
	}
	if (data.games != "skip")
	{
		let game_table = data.games.split(" ")
		let games = []
		for (let game of game_table) {
			game = Number(game)
			if (!isNaN(game))
			{
				games.push(game)
			}
		}
		config.games = games
	}
	db.state.accounts.push(config)
	db.save()
	RegisterAccount(config)

	if (ctx) ctx.replyWithHTML("<b>Аккаунт добавлен. Введите</b> /panel.\nПри наличии ошибок, вы получите сообщение")

	delete accounts_add[id]
}


bot.command("add", (ctx) => {
	if (!CheckAccess(ctx)) return
	var user = ctx.message.from.id
	ctx.replyWithHTML("<b>Для отмены введите</b> /cancel")
	accounts_add[user] = {stage:0}
	ctx.replyWithHTML(add_steps[0].text)
})

bot.command("access", (ctx) => {
	let user = ctx.message.from.id
	if (user != JOHNNY) {
		ctx.replyWithHTML("<b>Ты куда полез? Пошёл нахуй</b>")
		return
	}
	let text = ctx.message.text
	let args = text.split(" ")
	let user_id = args[1]
	if (!user_id) {
		var reply = "<b>Список юзеров:</b>	"
		db.state.users.forEach((element) => {
			reply += "\n" + String(element)
		})
		ctx.replyWithHTML(reply)
		return
	}
	user_id = Number(user_id)
	if (isNaN(user_id)) {
		ctx.replyWithHTML("Неверный айди")
		return
	}
	let index = db.state.users.indexOf(user_id)
	if (index > -1) {
		db.state.users.splice(index, 1)
		ctx.replyWithHTML("Айди удалён")
	}
	else {
		db.state.users.push(user_id)
		ctx.replyWithHTML("Айди добавлен")
	}
	db.save()
})

bot.command("notify", (ctx) => {
	let user = ctx.message.from.id
	if (user != JOHNNY) {
		ctx.replyWithHTML("<b>Ты куда полез? Пошёл нахуй</b>")
		return
	}
	let text = ctx.message.text.slice(8)
	if (!text || text.length < 2) {
		ctx.replyWithHTML("<b>Неверный текст</b>")
		return
	}
	let notify = "<b>❗ Оповещение</b>\n" + text
	db.state.users.forEach((user) => {
		bot.telegram.sendMessage(user, notify, { parse_mode: "HTML" })
	})
})

bot.command("code", (ctx) => {
	var user = ctx.message.from.id
	var text = ctx.message.text
	var args = text.split(" ")

	var name = args[1]
	var code = args[2]
	if (!user) {
		ctx.replyWithHTML("Нужно указать имя/логин аккаунта")
		return
	}
	if (!code) {
		ctx.replyWithHTML("Нужно указать код")
		return
	}
	var need
	for (let client of clientArray) {
		if ((client.name == name || client.login == name) && client.owner == user) {
			need = client
		}
	}
	if (!need) {
		ctx.replyWithHTML("Аккаунт не найден")
		return
	}
	if (!need.steamguard) {
		ctx.replyWithHTML("Коллбек стимгуарда не найден")
		return
	}
	need.steamguard(code)
	delete need.steamguard
	ctx.replyWithHTML("Стимгуард применён. Проверяйте")
})

/*
	ACCOUNT MANAGEMENT
*/

let account_controls = [
	[Markup.button.callback("🔓 Генерация кода", "..code")],
	[Markup.button.callback("📝 Переименовать", "..rename")],
	[Markup.button.callback("📜 Изменить игры", "..edit_games")],
	[Markup.button.callback("🧭 Изменить надпись", "..edit_text")],
	[Markup.button.callback("✋ Остановить", "..stop")],
	[Markup.button.callback("🎬 Перезапустить", "..relog")],

	[Markup.button.callback("🗑️ Удалить", "..delete")]
]

let user_actions = {}

bot.command("cancel", (ctx) => { // Cancel current action
	let user = ctx.message.from.id
	if (!accounts_add[user] && !user_actions[user])
	{
		ctx.replyWithHTML("<b>Не могу найти активное действие. Оно точно есть?</b>")
		return
	}
	delete user_actions[user]
	delete accounts_add[user]
	ctx.replyWithHTML("<b>Активное действие отключено</b>")
})

bot.action(/(::)/, (ctx) => { // Regular for defining account login
	let user = ctx.update.callback_query.from.id
	if (!HasAccess(user))
	{
		ctx.answerCbQuery("У вас нету доступа к боту")
		return
	}
	let input = ctx.match.input
	let login = input.substring(2)
	let account = FindAccount(login, user)
	if (!account)
	{
		ctx.editMessageText("Аккаунт не найден")
		return
	}
	let text = GenerateAccountInfo(account)
	let accounts_buttons = account_controls.slice()
	accounts_buttons.splice(0, 0, [Markup.button.callback(account.name, "::" + account.login)])
	try {
		ctx.editMessageText(text, {parse_mode: "HTML", disable_web_page_preview: true, reply_markup:{inline_keyboard:accounts_buttons}})
	} catch(e) {
		ctx.answerCbQuery("Не смог обновить сообщение")
	}
})

bot.action(/(..)/, (ctx) => { // Regular for defining control buttons
	let user = ctx.update.callback_query.from.id
	if (!HasAccess(user))
	{
		ctx.answerCbQuery("У вас нету доступа к боту")
		return
	}

	let query = ctx.update.callback_query
	let inline = query.message.reply_markup.inline_keyboard
	let login = inline[0][0].callback_data
	login = login.substring(2)

	let account = FindAccount(login, user)
	if (!account) {
		ctx.editMessageText("Аккаунт не найден")
		return
	}

	let accounts_buttons = account_controls.slice()
	accounts_buttons.splice(0, 0, [Markup.button.callback(account.name, "::" + account.login)])

	let input = ctx.match.input
	switch (input) {
		case "..code":
			let text = GenerateAccountInfo(account)
			text = text + "\n\n<b>SteamGuard:</b> <code>" + account.GenerateCode() + "</code>"

			try {
				ctx.editMessageText(text, {parse_mode: "HTML", disable_web_page_preview: true, reply_markup:{inline_keyboard:accounts_buttons}})
			} catch(e) {
				ctx.answerCbQuery("Не смог обновить сообщение")
			}
			break
		case "..rename":
			user_actions[user] = {act:input, login:account.login}
			ctx.editMessageText("Хорошо, вы изменяете название <code>" + account.name + "</code>\nТеперь <b>введите новое название</b>.\n<b>Передумали?</b> Введите /cancel.", {parse_mode: "HTML"})
			break
		case "..edit_games":
			user_actions[user] = {act:input, login:account.login}
			ctx.editMessageText("Хорошо, вы изменяете список игр для <code>" + account.name + "</code>\n<b>Теперь введите список игр через пробел</b>.\nЕсли желаете включить автоматический выбор каждых 4 часа - введите <code>skip</code>.\n<b>Передумали?</b> Введите /cancel.", {parse_mode: "HTML"})
			break
		case "..edit_text":
			user_actions[user] = {act:input, login:account.login}
			ctx.editMessageText("Хорошо, вы изменяете кастомное название игры для <code>" + account.name + "</code>\n<b>Этот текст будет отображаться в профиле.</b>\nЧтобы убрать - введите <code>skip</code>.\n<b>Передумали?</b> Введите /cancel.", {parse_mode: "HTML"})
			break
		case "..stop":
			account.logOff()
			ctx.editMessageText("Буст на аккаунте <code>" + account.name + "</code> <b>остановлен</b>.", {parse_mode: "HTML"})
			break
		case "..relog":
			account.Relog()
			ctx.editMessageText("Буст на аккаунте <code>" + account.name + "</code> <b>перезапущен</b>.", {parse_mode: "HTML"})
			break
		case "..delete":
			db.state.accounts.forEach(function(value, index) {
				if (value.login == account.login && value.owner == user) {
					db.state.accounts.splice(index, 1)
				}
			})
			clientArray.forEach(function(client, index) {
				if (client.login == account.login && client.owner == user) {
					client.doRemove()
					clientArray.splice(index, 1)
				}
			})
			db.save()
			ctx.editMessageText("Аккаунт был удален из базы. Введите /panel")
			break
	}
})

bot.on("message", (ctx) => {
	let user = ctx.message.from.id
	let text = ctx.message.text
	if (!text) return
	let add_account = accounts_add[user]
	if (add_account) {
		let stage = add_account.stage
		let info = add_steps[stage]
		let result = info.check(text)
		if (result)
		{
			ctx.replyWithHTML(result)
			return
		}
		let var_name = info.name
		add_account[var_name] = text

		stage += 1
		let cur_stage = add_steps[stage]
		if (!cur_stage) {
			AddAccount(user, ctx)
			return
		}
		accounts_add[user].stage = stage
		ctx.replyWithHTML(cur_stage.text)
		return
	}
	let action = user_actions[user]
	if (!action) return
	let login = action.login

	switch (action.act)
	{
		case "..rename":
			if (text.includes(" ") || text.includes("\n")) {
				ctx.replyWithHTML("<b>В названии нельзя использовать пробелы</b>")
				return
			}
			db.state.accounts.forEach(function(value, index) {
				if (value.login == login && value.owner == user) {
					db.state.accounts[index].name = text
				}
			})
			db.save()
			clientArray.forEach(function(client, index) {
				if (client.login == login && client.owner == user) {
					clientArray[index].name = text
				}
			})
			ctx.replyWithHTML("<b>Изменения применены</b>")
			break
		case "..edit_games":
			let games
			if (text != "skip") {
				games = text.split(" ")
				games.forEach(function(value, index) {
					let game = Number(value)
					if (isNaN(game)) {
						ctx.replyWithHTML("<b>Игра должна быть указана числом</b>")
						return
					}
				})
				if (games.length > 32) {
					ctx.replyWithHTML("<b>Лимит - 32 игры</b> ( указано" + String(games.length) + " )")
					return
				}
			}
			db.state.accounts.forEach(function(value, index) {
				if (value.login == login && value.owner == user) {
					db.state.accounts[index].games = games
				}
			})
			db.save()
			clientArray.forEach(function(client, index) {
				if (client.login == login && client.owner == user) {
					clientArray[index].games = games
				}
			})
			ctx.replyWithHTML("<b>Изменения применены</b>")
			break
		case "..edit_text":
			let custom_name
			if (text != "skip") {
				custom_name = text
			}
			db.state.accounts.forEach(function(value, index) {
				if (value.login == login && value.owner == user) {
					db.state.accounts[index].game_text = custom_name
				}
			})
			db.save()
			clientArray.forEach(function(client, index) {
				if (client.login == login && client.owner == user) {
					clientArray[index].game_text = custom_name
					clientArray[index].Relog()
				}
			})
			ctx.replyWithHTML("<b>Изменения применены. Буст перезапускается</b>")
			break
	}


	delete user_actions[user]
})
