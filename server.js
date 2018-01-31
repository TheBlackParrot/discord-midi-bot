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
		stream: new stream.PassThrough(),
		timidity: null
	};
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
		var args = parts.slice(1);
	}

	const cmds = {
		play: function(args) {
			if(args.length == 0) {
				msg.channel.sendMessage("You must specify a file.");
				return;
			}

			playMIDI(args[0], msg);
		},

		stop: function() {
			msg.channel.guild.voiceConnection.disconnect();
		},

		soundfont: function(args) {
			if(args.length == 0) {
				var out = [];
				fs.readdir(settings.soundfont_folder, function(err, files) {
					files.forEach(function(file) {
						var size = Math.floor(fs.statSync(settings.soundfont_folder + file).size / 1000000.0);
						out.push("**" + file + "** (" + size + " MB)");
					})
					msg.channel.sendMessage(":warning: You must specify a file. \r\n\r\n:drum: Available soundfonts:\r\n" + out.join("\r\n"));
				})
				return;
			}

			args[0] = args[0].replace(/\.\./g, "");
			var sf2 = settings.soundfont_folder + args[0];

			fs.access(sf2, fs.constants.F_OK, function(err) {
				if(err) {
					msg.channel.sendMessage("File doesn't exist.");
					return;
				}

				gsettings.soundfont = sf2;

				msg.channel.sendMessage(":drum: Soundfont changed to **" + sf2.split('\\').pop().split('/').pop() + "**");
			})
		},

		songs: function(args) {
			var attachment_stream = new stream.PassThrough();
			fs.readdir(settings.midi_folder + (args.length > 0 ? args[0].replace(/\.\./g, "") : ""), function(err, files) {
				var attachment = new discord.Attachment(Buffer.from(files.join("\r\n")), "midi" + Date.now() + ".txt");
				msg.channel.send("Available midi files:", attachment);
			});		
		},

		channels: function(args) {
			if(args[0] == 1) {
				gsettings.out_channels = 1;
				msg.channel.send("Now playing in mono. Reverb has also been disabled.");
			} else if(args[0] == 2) {
				gsettings.out_channels = 2;
				msg.channel.send("Now playing in stereo.");
			}
		},

		help: function() {
			var out = [
				"**TheBlackParrot's MIDI Audio Bot**",
				"https://github.com/TheBlackParrot/discord-midi-bot",
				"",
				"**Commands**:",
				"`" + settings.identifier + "play [file]`: Play a midi file.",
				"`" + settings.identifier + "stop`: Stop playback.",
				"`" + settings.identifier + "soundfont(/sf2/sf/font)`: Get a list of available soundfonts.",
				"`" + settings.identifier + "soundfont(/sf2/sf/font) [file]`: Change the soundfont in use.",
				"`" + settings.identifier + "songs`: List available midi tracks.",
				"",
				"**To do/need help with:**",
				"Tempo command",
				"Reverb percentage command",
				"Master volume command (1st part of `-A`)",
				"Drum amplification command (2nd part of `-A`)",
				"Radio mode",
				"Skipping songs in radio mode",
				"Resuming playback in radio mode after a song is manually played",
				"Toggle for now playing messages",
				"stdin (timidity) support via request/curl/etc *(big security hazard here, unsure if this should be added at the moment)*",
				"Permissions for the soundfont (and tempo, now playing msg toggle) command",
				"Windows/OSX support?"
			];
			msg.channel.send(out.join("\r\n"));
		}
	}

	// shortcuts
	cmd.sf2 = cmd.sf = cmd.instruments = cmd.sounds = cmd.font = cmd.soundfont;
	cmd.tracks = cmd.midis = cmd.list = cmd.songs;
	cmd.endless = cmd.forever = cmd.random = cmd.radio;

	if(cmd in cmds) {
		cmds[cmd](args);
	}
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
			connection.playStream(guild_settings[msg.guild.id].stream, {passes: 2, volume: 0.8, bitrate: 96000});

			if(file == "random") {
				streamMIDI(file, msg, connection);
				return;
			}

			file = settings.midi_folder + file.replace(/\.\./g, "");
			fs.access(file, fs.constants.F_OK, function(err) {
				if(err) {
					msg.channel.sendMessage("File doesn't exist.");
					return;
				}

				streamMIDI(file, msg, connection);
			});
		});
}

function streamMIDI(file, msg, connection) {
	var guild = msg.guild.id;
	var gsettings = guild_settings[guild];

	if(file == "random") {
		var files = fs.readdirSync(settings.midi_folder)
		file = settings.midi_folder + files[getRandomInt(files.length)];
	} else {
		file = file.replace(/\.\./g, "");
	}
	var midiname = file.split('\\').pop().split('/').pop();
	
	var sf2 = gsettings.soundfont;
	var sf2name = sf2.split('\\').pop().split('/').pop();

	msg.channel.sendMessage(":play_pause: Now playing **" + midiname + "** using soundfont *" + sf2name + "*");

	var master_vol = 40;
	var drum_vol = 140;
	var out_mode = "-Ow";
	var effects = [];
	if(gsettings.out_channels == 1) {
		effects = ["--reverb=0", "-EFreverb=d"];
		out_mode = "-OwM";
	}
	
	var args = ['-x', 'soundfont ' + sf2, '-A40,140'];
	if(effects.length > 0) {
		args = args.concat(effects);
	}
	args = args.concat([file, out_mode, "-o", "-"]);
	
	if(gsettings.timidity) {
		console.log("killing previous timidity process...");
		gsettings.timidity.stdout.unpipe();
		gsettings.timidity.kill();
		while(gsettings.stream.read() != null) {
			console.log("flushing 1");
			gsettings.stream.read();
		}
		connection.dispatcher.stream.resume();
		while(connection.dispatcher.stream.read() != null) {
			console.log("flushing 2");
			connection.dispatcher.stream.read();
		}
		connection.dispatcher.stream.pause();
	}
	gsettings.timidity = spawn('timidity', args);
	gsettings.timidity.stdout.pipe(gsettings.stream);
}
// timidity -x "soundfont /home/theblackparrot/TimbresOfHeaven3.4.sf2" xmusic5.mid -Ow -o - | ffmpeg -i - -acodec libopus -b:a 192k -y /tmp/test.opus