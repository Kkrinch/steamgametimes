const SteamUser = require("steam-user")
const SteamTotp = require("steam-totp")

let newClient = {}

let minute = 1000 * 60 // 1000 мс = секунда, 60 секунд = минута
let relog_time = minute * 10 // 10 минут на переподключение
let newgames_time = minute * 60 * 4 //

function select_games(arr) {
	arr.sort(() => Math.random() - 0.5)
	if (arr.length > 32 && arr.length != 0) {
		var new_arr = arr.slice(0, 31)
		return new_arr
	} else {
		return arr
	}
}

newClient.execute = function (config) {

    let client = new SteamUser({

        autoRelogin: true,
        promptSteamGuardCode: false,
        dataDirectory: "./sentry",
        singleSentryfile: false
    })

	client.name = config.name
    client.login = config.login
    client.password = config.password
    client.sharedSecret = config.sharedSecret
    client.games = config.games
	client.owner = config.owner
	client.game_list = []
	if (config.richpresence) {
		client.richpresence = config.richpresence
	}

	client.on("disconnected", function (eresult, msg) {
		console.log("disconnected - " + msg)
        this.status = msg
		if (msg == "NoConnection" || msg == "Logged off") {
			setTimeout(function () { client.Relog() }, relog_time)
			this.status = "Steam is down"
		}
    })

	client.Boost = function() {
		let games
		if (client.games && client.games.length > 0) {
			games = client.games.slice().map(Number)
		} else {
			games = select_games(client.game_list).slice()
			setTimeout(function () { client.Boost() }, newgames_time)
		}
		if (client.game_text) {
			games.splice(0, 0, client.game_text)
		}

		client.gamesPlayed(games)
	}

	client.GenerateCode = function() {
		if (!client.sharedSecret) {
			return "unknown"
		}
		return SteamTotp.generateAuthCode(client.sharedSecret)
	}

    client.on("loggedOn", function (details) {
		if (this.needRelog) {
			console.log("[" + this.login + "] Logged on but need to relog ")
			return
		}
		this.steamid = details.client_supplied_steamid
		this.steamguard = null
        console.log("[" + this.login + "] Logged into Steam as " + client.steamID.getSteam3RenderedID())
        client.setPersona(SteamUser.EPersonaState.Online) // Set steam status [25-34 for all possible variants]
		if (client.richpresence) {
			this.uploadRichPresence(this.games[0], client.richpresence)
		}
		client.game_list = []
		this.getUserOwnedApps(client.steamID, function(err, response) {
			if (err) {
				console.log("[" + client.login + "] Error parsing games: " + err)
				client.Relog()
			} else {
				let games = response.apps
				for (let game of games) {
					client.game_list.push(game.appid)
				}
				console.log("[" + client.login + "] Games count: " + client.game_list.length)
			}
			client.Boost()
		})
		this.status = "Boosting"
		this.prefix = null
    })

	client.on("accountInfo", function(name, country, authed) {
		client.steam_name = name
		client.authedCount = authed
		console.log("[" + this.login + "] Got name: " + name)
	})
	
	client.on("wallet", function(has, currency, balance) {
		client.currency = currency
		client.balance = balance
		client.GetBalance = function() {
			return SteamUser.formatCurrency(balance, currency)
		}
		console.log("[" + this.login + "] Balance: " + balance + ". Currency: " + currency)
	})
    /* Value-to-name mapping for convenience
    "0": "Offline",
    "1": "Online",
    "2": "Busy",
    "3": "Away",
    "4": "Snooze",
    "5": "LookingToTrade",
    "6": "LookingToPlay",
    "7": "Invisible",
    */

	client.Relog = function () {
		if (this.disabled) {
			return
		}
		if (this.status == "Boosting") {
			this.logOff()
		}
		console.log("[" + this.login + "] Relogging")
		this.doLogin()
		this.needRelog = false
	}


    client.on("error", function (err) {
		this.steamguard = null
        console.log("[" + this.login + "] " + err)
		this.status = err
		this.prefix = "⚠️ "
        setTimeout(function () { client.Relog() }, relog_time)
		this.needRelog = true
		if (this.Notify) {
			let name = this.name || this.login
			if (err == "Error: InvalidLoginAuthCode") {
				this.Notify("#error\n<b>Указан неверный код для</b> <code>" + name + "</code>.\n Введите <code>/code " + name + " код_с_почты</code>")
			} else if (err == "Error: InvalidPassword") {
				this.Notify("#error\n<b>Указан неверный пароль для</b> <code>" + name + "</code>.")
				this.doRemove()
			}
		}
    })

    client.doLogin = function () {
        this.logOn({
            "accountName": this.login,
            "password": this.password
        })
		this.steamguard = null
		this.status = "Logged in"
		this.prefix = null
    }

	client.doRemove = function () {
		console.log("[" + this.login + "] Disabling account")
		this.logOff()
		this.disabled = true
		delete this
	}

    client.on("steamGuard", function (domain, callback, wrong) {
        if (!this.sharedSecret) {

            // Никаких запросов SteamGuard, нам это не подходит. Полная автоматика.
			if (wrong && this.Notify) {
				let name = this.name || this.login
				this.Notify("Был указан неверный код <code>" + name + "</code>.\nВы точно ввели верный код с почты?")
			}
			let cur_domain = (domain || "unknown")
			console.log("[" + this.login + "] Waiting for code from " + cur_domain)
			this.status = "SharedSecret is missing. Domain: " + cur_domain
			this.prefix = "⁉️ "
			this.steamguard = callback
			if (this.Notify) {
				let name = this.name || this.login
				this.Notify("На почту с доменом " + cur_domain + " было выслано письмо для авторизации аккаунта с именем <code>" + name + "</code>.\n Введите <code>/code " + name + " код_с_почты</code>")
			}
        }
        else {
			if (wrong) {
				this.invalid_sharedsecret = (this.invalid_sharedsecret || 0) + 1
				console.log("[" + this.login + "] Last 2FA was invalid")
			}
			if ((this.invalid_sharedsecret || 0) > 3) {
				this.status = "Invalid 2fa code"
				this.prefix = "❌ "
				if (this.Notify) {
					let name = this.name || this.login
					this.Notify("Был неверно сгенерирован код <code>" + name + "<code>.\nВы точно ввели верный SharedSecret?")
				}
				return
			}
			this.invalid_sharedsecret = 0
			this.status = "Generating auth code"
			this.prefix = null
            var authCode = this.GenerateCode()
            console.log("[" + this.login + "] Generated Auth Code: " + authCode)
            callback(authCode)
        }

    })

    //client.on("friendMessage", function (steamID, message) {
    //    console.log("[" + this.login + "] Message from " + steamID + ": " + message)
    //})


    client.on("vacBans", function (numBans, appids) {
		client.bans = appids || []

        if (numBans > 0) {

            // Показывает баны аккаунта, если есть. Спасибо тернарному "?" за сокращение строк.
            console.log("[" + this.login + "] " + numBans + " VAC ban" + (numBans == 1 ? "" : "s") + "." +
                (appids.length == 0 ? "" : " In apps: " + appids.join(", ")))
        }
    })

    client.on("accountLimitations", function (limited, communityBanned, locked, canInviteFriends) {
		client.limitations = []

        if (limited) {
            client.limitations.push("Ограничения ( 5$ )")
        }

        if (communityBanned) {
            client.limitations.push("Блокировка сообщества")
        }

        if (locked) {
            client.limitations.push("Заблокирован вручную")
        }

        if (client.limitations.length !== 0) {
            console.log("[" + this.login + "] Limitations: " + client.limitations.join(", ") + ".")
        }
    })

    return client
}

module.exports = newClient
