const discord = require('discord.js');
const fs = require('fs');
const spawn = require('child_process').spawn;
const stream = require('stream');

var settings = require('./settings.json');

var bot = new discord.Client();

bot.on('ready', function() {
	console.log('Logged in as %s\n', bot.user.tag);
});

bot.on('error', function(err) { 
	//console.log(err);
});

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}

var guild_settings = {}; // guilds are read-only
function initGulidSettings() {
	return {
		soundfont: settings.soundfont_folder + settings.default_soundfont,
		radio_mode: false,
		out_channels: 2,
		timidity: null,
		reverb: 15,
		tempo: 100,
		rate: 48000,
		volume: {
			master: 40,
			drums: 140
		},
		normalize: true,
		key_adjust: 0,
		piano: false,
		notify: true,
		chorus: 0
	};
}

function parseCommand(msg, gsettings, cmd, args) {
	let roles = msg.guild.roles;

	switch(cmd) {
		case "play":
			if(args.length == 0) {
				msg.channel.send("You must specify a file.");
				return;
			}
			playMIDI(args[0], msg);
			break;

		case "stop":
			gsettings.radio_mode = false;
			msg.channel.guild.voiceConnection.disconnect();
			break;

		case "sounds":
		case "instruments":
		case "sf":
		case "sf2":
		case "soundfont":
		case "font":
			if(!msg.member.roles.find(role => role.name === settings.mod_role)) {
				msg.channel.send("You do not have the `" + settings.mod_role + "` role.");
				return;
			}

			if(args.length == 0) {
				/*var out = [];
				fs.readdir(settings.soundfont_folder, function(err, files) {
					files.forEach(function(file) {
						var size = Math.floor(fs.statSync(settings.soundfont_folder + file).size / 1000000.0);
						out.push(file);
					})
					msg.channel.send(":warning: You must specify a file. \r\n\r\n:drum: Available soundfonts:\r\n" + out.join("\r\n"));
				})*/
				var attachment_stream = new stream.PassThrough();
				fs.readdir(settings.soundfont_folder + (args.length > 0 ? args[0].replace(/\.\./g, "") : ""), function(err, files) {
					var attachment = new discord.MessageAttachment(Buffer.from(files.join("\r\n")), "soundfonts" + Date.now() + ".txt");
					msg.channel.send("Available soundfonts:", attachment);
				});		
				return;
			}

			if(args[0] == "random") {
				var files = fs.readdirSync(settings.soundfont_folder)
				var sf2 = settings.soundfont_folder + files[getRandomInt(files.length)];
			} else {
				args[0] = args[0].replace(/\.\./g, "");
				var sf2 = settings.soundfont_folder + args[0];
			}

			fs.access(sf2, fs.constants.F_OK, function(err) {
				if(err) {
					msg.channel.send("File doesn't exist.");
					return;
				}

				gsettings.soundfont = sf2;

				msg.channel.send(":drum: Soundfont changed to **" + sf2.split('\\').pop().split('/').pop() + "**");
			});
			break;

		case "mids":
		case "tracks":
		case "midis":
		case "songs":
			var attachment_stream = new stream.PassThrough();
			fs.readdir(settings.midi_folder + (args.length > 0 ? args[0].replace(/\.\./g, "") : ""), function(err, files) {
				var attachment = new discord.MessageAttachment(Buffer.from(files.join("\r\n")), "midi" + Date.now() + ".txt");
				msg.channel.send("Available midi files:", attachment);
			});		
			break;

		case "c":
		case "channels":
			if(args[0] == 1) {
				gsettings.out_channels = 1;
				msg.channel.send("Now playing in mono. Reverb has also been disabled.");
			} else if(args[0] == 2) {
				gsettings.out_channels = 2;
				msg.channel.send("Now playing in stereo.");
			}
			break;

		case "endless":
		case "continuous":
		case "radio":
			if(!msg.member.roles.find(role => role.name === settings.mod_role)) {
				msg.channel.send("You do not have the `" + settings.mod_role + "` role.");
				return;
			}

			if(gsettings.radio_mode && args.length > 0) {
				if(args[0] == "off") {
					gsettings.radio_mode = false;
					msg.channel.send("Radio mode has been disabled.");
				}
				return;
			}

			if(!gsettings.radio_mode) {
				gsettings.radio_mode = true;
				playMIDI("random", msg);
			} else {
				msg.channel.send("Radio is already playing.");
			}
			break;

		case "next":
		case "skip":
			if(gsettings.radio_mode) {
				gsettings.timidity.stdout.removeAllListeners("close");
				gsettings.timidity.stdout.once("disconnect", function() {
					if(gsettings.radio_mode) {
						streamMIDI("random", msg, connection);
					}
				});
				streamMIDI("random", msg, null);
			}
			break;

		case "r":
		case "reverb":
			if(args.length <= 0) {
				return;
			}

			var amount = parseInt(args[0]);
			if(isNaN(amount)) {
				return;
			}

			amount_fixed = Math.max(Math.min(Math.ceil((amount/100)*127), 127), 0);
			gsettings.reverb = amount_fixed;
			msg.channel.send("Reverb set to " + amount + "%");
			break;

		case "speed":
		case "t":
		case "tempo":
			if(args.length <= 0) {
				return;
			}

			var amount = parseInt(args[0]);
			if(isNaN(amount)) {
				return;
			}

			amount = Math.max(Math.min(amount, 300), 25);
			gsettings.tempo = amount;
			msg.channel.send("Tempo set to " + amount + "% of normal speed.");			
			break;

		case "p":
		case "pitch":
			if(args.length <= 0) {
				return;
			}

			var amount = parseInt(args[0]);
			if(isNaN(amount)) {
				return;
			}

			amount = Math.max(Math.min(amount, 200), 75);
			gsettings.rate = Math.ceil((100/amount)*48000);
			msg.channel.send("Pitch set to " + amount + "%");
			break;

		case "mv":
		case "v":
		case "vol":
		case "volume":
			if(args.length <= 0) {
				return;
			}

			var amount = parseInt(args[0]);
			if(isNaN(amount)) {
				return;
			}

			amount = Math.max(Math.min(amount, 200), 0);
			gsettings.volume.master = Math.ceil((amount/100)*40);
			msg.channel.send("Master volume set to " + amount + "%");			
			//msg.channel.send("DEBUG: " + gsettings.volume.master);
			break;

		case "drumsvol":
		case "drumvol":
		case "drumsvolume":
		case "dv":
		case "drumvolume":
			if(args.length <= 0) {
				return;
			}

			var amount = parseInt(args[0]);
			if(isNaN(amount)) {
				return;
			}

			amount = Math.max(Math.min(amount, 200), 0);
			gsettings.volume.drums = Math.ceil((amount/100)*150);
			msg.channel.send("Drum volume set to " + amount + "%");		
			//msg.channel.send("DEBUG: " + gsettings.volume.drums);	
			break;

		case "norm":
		case "n":
		case "normalize":
			if(gsettings.normalize && args.length > 0) {
				if(args[0] == "off") {
					gsettings.normalize = false;
					msg.channel.send("Volume normalizing has been disabled.");
				}
				return;
			}

			if(!gsettings.normalize) {
				gsettings.normalize = true;
				msg.channel.send("Volume normalizing has been enabled.");
			}	
			break;

		case "keyadjust":
		case "k":
		case "key":
			if(args.length <= 0) {
				return;
			}

			var amount = parseInt(args[0]);
			if(isNaN(amount)) {
				return;
			}

			gsettings.key_adjust = Math.max(Math.min(amount, 24), -24);

			if(gsettings.key_adjust == 0) {
				msg.channel.send("MIDIs will now play in their initial key.");
			} else if(gsettings.key_adjust < 0) {
				msg.channel.send("MIDIs will now play " + Math.abs(gsettings.key_adjust).toString() + " semitones lower.");
			} else if(gsettings.key_adjust > 0) {
				msg.channel.send("MIDIs will now play " + Math.abs(gsettings.key_adjust).toString() + " semitones higher.");
			}
			break;

		case "pianomode":
		case "pianoonly":
			if(!msg.member.roles.find(role => role.name === settings.mod_role)) {
				msg.channel.send("You do not have the `" + settings.mod_role + "` role.");
				return;
			}

			if(gsettings.piano && args.length > 0) {
				if(args[0] == "off") {
					gsettings.piano = false;
					msg.channel.send("Piano-only mode has been disabled.");
				}
				return;
			}

			if(!gsettings.piano) {
				gsettings.piano = true;
				msg.channel.send("Piano-only mode has been enabled.");
			}
			break;

		case "notify":
		case "nowplayingnotify":
		case "nowplayingnotifications":
		case "npn":
		case "notifications":
			if(!msg.member.roles.find(role => role.name === settings.mod_role)) {
				msg.channel.send("You do not have the `" + settings.mod_role + "` role.");
				return;
			}
			
			if(gsettings.notify && args.length > 0) {
				if(args[0] == "off") {
					gsettings.notify = false;
					msg.channel.send("Now playing notifications have been disabled.");
				}
				return;
			}

			if(!gsettings.notify) {
				gsettings.notify = true;
				msg.channel.send("Now playing notifications have been enabled.");
			}	
			break;

		case "preset":
			if(!msg.member.roles.find(role => role.name === settings.mod_role)) {
				msg.channel.send("You do not have the `" + settings.mod_role + "` role.");
				return;
			}

			if(args.length == 0) {
				var attachment_stream = new stream.PassThrough();
				fs.readdir(settings.presets_folder, function(err, files) {
					var attachment = new discord.MessageAttachment(Buffer.from(files.join("\r\n")), "presets" + Date.now() + ".txt");
					msg.channel.send("Available presets:", attachment);
				});		
				return;
			}

			if(args[0] == "random") {
				var files = fs.readdirSync(settings.presets_folder)
				var preset = settings.presets_folder + files[getRandomInt(files.length)];
			} else {
				args[0] = args[0].replace(/\.\./g, "");
				var preset = settings.presets_folder + args[0];
			}

			fs.access(preset, fs.constants.F_OK, function(err) {
				if(err) {
					msg.channel.send("File doesn't exist.");
					return;
				}

				fs.readFile(preset, {encoding: "utf8"}, function(err, data) {
					if(err) {
						msg.channel.send("Couldn't read preset.");
						return;
					}

					data.split("\n").map(function(line) {
						var parts = line.split(" ");
						parseCommand(msg, gsettings, parts[0], parts.slice(1));
					});
				});

				//msg.channel.send(":drum: Soundfont changed to **" + preset.split('\\').pop().split('/').pop() + "**");
			});
			break;

		case "chorus":
		case "ch":
			if(args.length <= 0) {
				return;
			}

			var amount = parseInt(args[0]);
			if(isNaN(amount)) {
				return;
			}

			amount = Math.max(Math.min(amount, 100), 0);
			gsettings.chorus = Math.ceil((amount/100)*127);
			msg.channel.send("Chorus set to " + amount + "%");
			break;

		case "?":
		case "help":
			var out = [
				"**TheBlackParrot's MIDI Audio Bot**",
				"https://github.com/TheBlackParrot/discord-midi-bot",
				"",
				"**Commands**:",
				"`" + settings.identifier + "play [file]`: Play a midi file.",
				"`" + settings.identifier + "stop`: Stop playback.",
				"`" + settings.identifier + "soundfont(/sf2/sf/font)`: Get a list of available soundfonts.",
				"`" + settings.identifier + "soundfont(/sf2/sf/font) [file]`: Change the soundfont in use. *(default: " + settings.default_soundfont + ")*",
				"`" + settings.identifier + "songs`: List available midi tracks.",
				"`" + settings.identifier + "radio [off]`: Begin playing music endlessly. Use \"off\" to disable it.",
				"`" + settings.identifier + "skip`: Skip the currently playing track *(only in radio mode)*.",
				"`" + settings.identifier + "channels [1,2]`: Set the amount of channels being output *(default: 2)*.",
				"`" + settings.identifier + "reverb [0-100]`: Set the amount of reverb *(default: 15)*.",
				"`" + settings.identifier + "tempo [25-300]`: Slow down or speed up the music *(default: 100)*.",
				"`" + settings.identifier + "pitch [75-200]`: Make the music sound lower or higher in pitch *(default: 100)*.",
				"`" + settings.identifier + "volume [0-200]`: Make the music sound lower or higher in pitch *(default: 100)*.",
				"`" + settings.identifier + "drumvolume [0-200]`: Make the music sound lower or higher in pitch *(default: 100)*.",
				"`" + settings.identifier + "normalize [off]`: Toggle volume normalization *(default: on)*.",
				"`" + settings.identifier + "key [-24,24]`: Adjust the overall key of the song *(default: 0)*.",
				"`" + settings.identifier + "pianoonly [off]`: Toggle piano-only mode *(default: off)*.",
				"`" + settings.identifier + "multiline`: Lets the input parser know you're about to input multiple commands.",
				"`" + settings.identifier + "notify [off]`: Enable automatic notifications of what's currently playing. *(default: on)*",
				"`" + settings.identifier + "preset`: List all command presets.",
				"`" + settings.identifier + "preset [file]`: Change settings to what a preset defines.",
				"`" + settings.identifier + "chorus [0-100]`: Set the amount of chorus *(default: 0)*.",
				"",
				"**Multiline Example**",
				"```",
				"!$multiline channels 1",
				"sf2 The_Ultimate_Megadrive_Soundfont.sf2",
				"tempo 66",
				"pitch 75",
				"```",
				"",
				"**To do/need help with:**",
				"stdin (timidity) support via request/curl/etc *(big security hazard here, unsure if this should be added at the moment)*",
				"Permissions for the soundfont (and tempo, now playing msg toggle) command",
				"Windows/OSX support?"
			];
			msg.channel.send(out.join("\r\n"));
			break;
	}
}

bot.on('message', function(msg) {
	if(!msg.guild) {
		return;
	}

	var guild_id = msg.guild.id;
	if(!(guild_id in guild_settings)) {
		guild_settings[guild_id] = initGulidSettings();
	}
	var gsettings = guild_settings[guild_id];

	var iden = settings.identifier;

	if(bot.user.id == msg.author.id) { return; }
	if(msg.content.length <= iden.length) { return; }
	if(msg.content.substr(0, iden.length) != iden) { return; }

	var parts = msg.content.substr(2).split(" ");

	var cmd = parts[0];
	var args = [];
	if(parts.length > 1) {
		args = parts.slice(1);
	}

	if(cmd == "multiline") {
		let content = msg.content.replace(iden + "multiline", "").trim();
		let lines = content.split("\n").map(function(line) {
			line = line.trim();
			console.log(line);

			if(line.length) {
				parts = line.split(" ");
				cmd = parts[0];
				args = [];

				if(parts.length > 1) {
					args = parts.slice(1);
				}

				parseCommand(msg, gsettings, cmd, args);
			}
		});
	} else {
		parseCommand(msg, gsettings, cmd, args);
	}

	/*
	if(cmd in cmds) {
		if(cmd != "multiline") {
			cmds[cmd](args);
		} else {
			cmds[cmd](msg.content);
		}
	}
	*/
});

bot.login(settings.token);

function playMIDI(file, msg) {
	if(!msg.member.voiceChannel) {
		return;
	}

	if(msg.guild.voiceConnection) {
		if(msg.guild.voiceConnection.dispatcher) {
			msg.guild.voiceConnection.dispatcher.end();
		}
	}

	msg.member.voiceChannel.join()
		.then(function(connection) {
			if(file == "random") {
				streamMIDI(file, msg, connection);
				return;
			}

			file = settings.midi_folder + file.replace(/\.\./g, "");
			fs.access(file, fs.constants.F_OK, function(err) {
				if(err) {
					msg.channel.send("File doesn't exist.");
					return;
				}

				streamMIDI(file, msg, connection);
			});
		});
}

function streamMIDI(file, msg, connection) {
	var guild = msg.guild.id;
	var gsettings = guild_settings[guild];

	if(connection == null) {
		connection = msg.guild.voiceConnection;
	}

	if(file == "random") {
		var files = fs.readdirSync(settings.midi_folder)
		file = settings.midi_folder + files[getRandomInt(files.length)];
	} else {
		file = file.replace(/\.\./g, "");
	}
	var midiname = file.split('\\').pop().split('/').pop();
	
	var sf2 = gsettings.soundfont;
	var sf2name = sf2.split('\\').pop().split('/').pop();

	var out_mode = "-Ow";
	var effects = [];
	if(gsettings.out_channels == 1) {
		effects = ["--reverb=0", "-EFreverb=d"];
		out_mode = "-OwM";
	} else {
		if(gsettings.reverb) {
			effects = ["-EFreverb=f," + gsettings.reverb];
		} else {
			effects = ["--reverb=0", "-EFreverb=d"];
		}
	}

	if(gsettings.chorus) {
		effects = effects.concat(["-EFchorus=s," + gsettings.chorus]);
	}
	
	var rate = gsettings.rate;
	if(gsettings.out_channels == 1) {
		rate = gsettings.rate*2;
	}

	var args = ['-x', 'soundfont ' + sf2, '-A' + Object.values(gsettings.volume).join(',') + (gsettings.normalize ? "a" : ""), '-T' + gsettings.tempo, '-s' + rate, '-K' + gsettings.key_adjust];
	if(effects.length > 0) { args = args.concat(effects); }
	if(gsettings.piano) { args = args.concat(['-Q10', '-EB0', '-EI0']); }
	args = args.concat([file, out_mode, "-o", "-"]);
	//msg.channel.send("DEBUG: " + args.join(" "));
	
	if(gsettings.timidity) {
		//console.log("killing previous timidity process...");
		gsettings.timidity.stdout.unpipe();
		gsettings.timidity.kill();
		gsettings.timidity.stdout.removeAllListeners("close");
	}
	
	gsettings.timidity = spawn('timidity', args);
	if(gsettings.notify) {
		msg.channel.send(":play_pause: Now playing **" + midiname + "** using soundfont *" + sf2name + "*");
	}

	setTimeout(function() {
		connection.play(gsettings.timidity.stdout, {passes: 3, volume: 0.8, bitrate: 96000, type: "converted"});
	}, 500);

	if(gsettings.radio_mode) {
		gsettings.timidity.stdout.once("close", function() {
			console.log("closed");
			if(gsettings.radio_mode) {
				streamMIDI("random", msg, connection);
			}
		});
	}
}
// timidity -x "soundfont /home/theblackparrot/TimbresOfHeaven3.4.sf2" xmusic5.mid -Ow -o - | ffmpeg -i - -acodec libopus -b:a 192k -y /tmp/test.opus
