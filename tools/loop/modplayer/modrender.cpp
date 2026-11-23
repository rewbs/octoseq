// modrender: render a tracker module with the instrumented OpenMPT engine.
//
//   modrender <module> <outdir> [--rate 48000] [--max-seconds 900] [--no-stems]
//
// Writes into <outdir>:
//   mix.wav        stereo float32 render of the whole module
//   stems/chNN.wav mono float32 render of each pattern channel on its own
//   events.json    every audible note trigger, the row/tempo grid and the order list
//
// Development tool for the Octoseq analysis-accuracy loop (tools/loop). It links
// against a patched libopenmpt built by build.sh and is not a product dependency.

#include <libopenmpt/libopenmpt.hpp>
#include <libopenmpt/libopenmpt_ext.hpp>

#include "soundlib/OctoseqHook.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

struct Log
{
	std::vector<octoseq::NoteEvent> notes;
	std::vector<octoseq::RowEvent> rows;
};

static void on_note(const octoseq::NoteEvent &ev, void *user) { static_cast<Log *>(user)->notes.push_back(ev); }
static void on_row(const octoseq::RowEvent &ev, void *user) { static_cast<Log *>(user)->rows.push_back(ev); }

static std::string json_string(const std::string &s)
{
	std::string out = "\"";
	for(unsigned char c : s)
	{
		if(c == '"' || c == '\\')
		{
			out += '\\';
			out += static_cast<char>(c);
		} else if(c < 0x20)
		{
			char buf[8];
			std::snprintf(buf, sizeof(buf), "\\u%04x", c);
			out += buf;
		} else
		{
			out += static_cast<char>(c);
		}
	}
	return out + "\"";
}

static std::string json_letter(char c)
{
	if(c == '\0' || c == '?')
		return "null";
	return json_string(std::string(1, c));
}

class WavWriter
{
public:
	WavWriter(const fs::path &path, int channels, int rate)
		: m_file(path, std::ios::binary), m_channels(channels), m_rate(rate)
	{
		write_header();
	}
	void write(const float *data, std::size_t samples)
	{
		m_file.write(reinterpret_cast<const char *>(data), static_cast<std::streamsize>(samples * sizeof(float)));
		m_bytes += samples * sizeof(float);
	}
	~WavWriter()
	{
		m_file.seekp(0);
		write_header();
	}

private:
	void u32(std::uint32_t v) { m_file.write(reinterpret_cast<const char *>(&v), 4); }
	void u16(std::uint16_t v) { m_file.write(reinterpret_cast<const char *>(&v), 2); }
	void write_header()
	{
		m_file.write("RIFF", 4);
		u32(static_cast<std::uint32_t>(36 + m_bytes));
		m_file.write("WAVEfmt ", 8);
		u32(16);
		u16(3);  // IEEE float
		u16(static_cast<std::uint16_t>(m_channels));
		u32(static_cast<std::uint32_t>(m_rate));
		u32(static_cast<std::uint32_t>(m_rate * m_channels * 4));
		u16(static_cast<std::uint16_t>(m_channels * 4));
		u16(32);
		m_file.write("data", 4);
		u32(static_cast<std::uint32_t>(m_bytes));
	}
	std::ofstream m_file;
	int m_channels, m_rate;
	std::uint64_t m_bytes = 0;
};

static std::unique_ptr<openmpt::module_ext> load(const std::vector<char> &data)
{
	std::ostringstream log;  // swallow loader chatter
	auto mod = std::make_unique<openmpt::module_ext>(data, log);
	// Fixed render settings: the same module must always give the same samples.
	mod->set_repeat_count(0);
	mod->set_render_param(openmpt::module::RENDER_INTERPOLATIONFILTER_LENGTH, 8);
	mod->set_render_param(openmpt::module::RENDER_VOLUMERAMPING_STRENGTH, 1);
	mod->set_render_param(openmpt::module::RENDER_STEREOSEPARATION_PERCENT, 100);
	mod->set_render_param(openmpt::module::RENDER_MASTERGAIN_MILLIBEL, 0);
	mod->ctl_set_boolean("render.resampler.emulate_amiga", false);
	mod->ctl_set_integer("dither", 0);
	mod->ctl_set_text("play.at_end", "stop");
	return mod;
}

// Render to the end (or the frame cap). Stereo if `stereo`, else the mono average.
static std::uint64_t render(openmpt::module_ext &mod, int rate, std::uint64_t max_frames, bool stereo, WavWriter &out)
{
	constexpr std::size_t chunk = 4096;
	std::vector<float> buf(chunk * 2);
	std::vector<float> mono(chunk);
	std::uint64_t total = 0;
	while(total < max_frames)
	{
		const std::size_t want = static_cast<std::size_t>(std::min<std::uint64_t>(chunk, max_frames - total));
		const std::size_t got = mod.read_interleaved_stereo(rate, want, buf.data());
		if(got == 0)
			break;
		if(stereo)
		{
			out.write(buf.data(), got * 2);
		} else
		{
			for(std::size_t i = 0; i < got; i++)
				mono[i] = 0.5f * (buf[2 * i] + buf[2 * i + 1]);
			out.write(mono.data(), got);
		}
		total += got;
	}
	return total;
}

int main(int argc, char **argv)
{
	if(argc < 3)
	{
		std::cerr << "usage: modrender <module> <outdir> [--rate N] [--max-seconds N] [--no-stems]\n";
		return 2;
	}
	const fs::path module_path = argv[1];
	const fs::path out_dir = argv[2];
	int rate = 48000;
	double max_seconds = 900.0;
	bool stems = true;
	for(int i = 3; i < argc; i++)
	{
		const std::string arg = argv[i];
		if(arg == "--rate" && i + 1 < argc)
			rate = std::stoi(argv[++i]);
		else if(arg == "--max-seconds" && i + 1 < argc)
			max_seconds = std::stod(argv[++i]);
		else if(arg == "--no-stems")
			stems = false;
		else
		{
			std::cerr << "unknown argument: " << arg << "\n";
			return 2;
		}
	}

	try
	{
		std::ifstream in(module_path, std::ios::binary);
		if(!in)
			throw std::runtime_error("cannot open " + module_path.string());
		const std::vector<char> data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
		const auto max_frames = static_cast<std::uint64_t>(max_seconds * rate);
		fs::create_directories(out_dir / "stems");

		// Pass 1: the full mix, with the event log switched on.
		Log log;
		octoseq::Hooks hooks;
		hooks.note = on_note;
		hooks.row = on_row;
		hooks.user = &log;
		auto mod = load(data);
		const int channels = mod->get_num_channels();
		std::uint64_t frames = 0;
		{
			WavWriter mix(out_dir / "mix.wav", 2, rate);
			octoseq::g_hooks = &hooks;
			frames = render(*mod, rate, max_frames, true, mix);
			octoseq::g_hooks = nullptr;
		}
		const bool truncated = (frames >= max_frames);

		// Passes 2..n: each channel on its own, everything else muted.
		std::vector<bool> used(static_cast<std::size_t>(channels), false);
		for(const auto &n : log.notes)
		{
			if(n.channel >= 0 && n.channel < channels)
				used[static_cast<std::size_t>(n.channel)] = true;
		}
		if(stems)
		{
			for(int ch = 0; ch < channels; ch++)
			{
				if(!used[static_cast<std::size_t>(ch)])
					continue;
				auto solo = load(data);
				auto *interactive = static_cast<openmpt::ext::interactive *>(solo->get_interface(openmpt::ext::interactive_id));
				if(!interactive)
					throw std::runtime_error("interactive interface unavailable");
				for(int other = 0; other < channels; other++)
					interactive->set_channel_mute_status(other, other != ch);
				char name[32];
				std::snprintf(name, sizeof(name), "ch%02d.wav", ch);
				WavWriter wav(out_dir / "stems" / name, 1, rate);
				render(*solo, rate, frames, false, wav);
			}
		}

		std::ofstream js(out_dir / "events.json");
		js.precision(10);
		js << "{\n";
		js << "\"format\": 1,\n";
		js << "\"module\": " << json_string(module_path.filename().string()) << ",\n";
		js << "\"title\": " << json_string(mod->get_metadata("title")) << ",\n";
		js << "\"type\": " << json_string(mod->get_metadata("type")) << ",\n";
		js << "\"tracker\": " << json_string(mod->get_metadata("tracker")) << ",\n";
		js << "\"sample_rate\": " << rate << ",\n";
		js << "\"frames\": " << frames << ",\n";
		js << "\"truncated\": " << (truncated ? "true" : "false") << ",\n";
		js << "\"channels\": " << channels << ",\n";
		js << "\"render\": {\"interpolation_taps\": 8, \"volume_ramping\": 1, \"stereo_separation\": 100, \"dither\": 0, \"amiga_resampler\": false},\n";

		js << "\"stem_channels\": [";
		{
			bool first = true;
			for(int ch = 0; ch < channels; ch++)
			{
				if(stems && used[static_cast<std::size_t>(ch)])
				{
					js << (first ? "" : ", ") << ch;
					first = false;
				}
			}
		}
		js << "],\n";

		js << "\"orders\": [";
		for(int o = 0; o < mod->get_num_orders(); o++)
			js << (o ? ", " : "") << mod->get_order_pattern(o);
		js << "],\n";

		js << "\"instruments\": [";
		{
			const auto names = mod->get_instrument_names();
			for(std::size_t i = 0; i < names.size(); i++)
				js << (i ? ", " : "") << json_string(names[i]);
		}
		js << "],\n";
		js << "\"samples\": [";
		{
			const auto names = mod->get_sample_names();
			for(std::size_t i = 0; i < names.size(); i++)
				js << (i ? ", " : "") << json_string(names[i]);
		}
		js << "],\n";

		js << "\"rows\": [\n";
		for(std::size_t i = 0; i < log.rows.size(); i++)
		{
			const auto &r = log.rows[i];
			js << "{\"t\": " << r.timeSamples << ", \"order\": " << r.order << ", \"pattern\": " << r.pattern
			   << ", \"row\": " << r.row << ", \"ticks\": " << r.ticksPerRow << ", \"tempo\": " << r.tempo
			   << ", \"samples_per_tick\": " << r.samplesPerTick << ", \"rows_per_beat\": " << r.rowsPerBeat
			   << ", \"rows_per_measure\": " << r.rowsPerMeasure << ", \"global_volume\": " << r.globalVolume << "}"
			   << (i + 1 < log.rows.size() ? ",\n" : "\n");
		}
		js << "],\n";

		js << "\"notes\": [\n";
		for(std::size_t i = 0; i < log.notes.size(); i++)
		{
			const auto &n = log.notes[i];
			js << "{\"t\": " << n.timeSamples << ", \"audible_t\": " << n.audibleSamples << ", \"order\": " << n.order
			   << ", \"pattern\": " << n.pattern << ", \"row\": " << n.row << ", \"tick\": " << n.tick
			   << ", \"channel\": " << n.channel << ", \"instrument\": " << n.instrument << ", \"sample\": " << n.sample
			   << ", \"note\": " << n.note << ", \"playback_rate\": " << n.playbackRate << ", \"volume\": " << n.realVolume
			   << ", \"channel_volume\": " << n.channelVolume << ", \"pan\": " << n.pan
			   << ", \"sample_offset\": " << n.sampleOffset << ", \"effect\": " << json_letter(n.effectLetter)
			   << ", \"effect_param\": " << n.effectParam << ", \"vol_effect\": " << json_letter(n.volLetter)
			   << ", \"vol_param\": " << n.volParam << ", \"cutoff\": " << n.cutoff << ", \"resonance\": " << n.resonance
			   << ", \"vibrato\": " << (n.vibrato ? "true" : "false") << ", \"tremolo\": " << (n.tremolo ? "true" : "false")
			   << ", \"arpeggio\": " << (n.arpeggio ? "true" : "false")
			   << ", \"portamento\": " << (n.portamento ? "true" : "false")
			   << ", \"background\": " << (n.background ? "true" : "false") << "}"
			   << (i + 1 < log.notes.size() ? ",\n" : "\n");
		}
		js << "]\n}\n";

		std::cout << module_path.filename().string() << ": " << frames << " frames, " << channels << " channels, "
		          << log.notes.size() << " note triggers, " << log.rows.size() << " rows"
		          << (truncated ? " (truncated)" : "") << "\n";
	} catch(const std::exception &e)
	{
		std::cerr << "modrender: " << e.what() << "\n";
		return 1;
	}
	return 0;
}
