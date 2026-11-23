// Render projectM (open-source Milkdrop) to raw frames, with no window and no clock.
//
// The loop uses this to measure what Milkdrop does with a track: how much of the
// frame moves, how hard, how the picture changes over time. projectM is the
// yardstick here, not part of the product.
//
//   pm_render --audio track.f32 --size 640x360 --fps 30 --seconds 60 \
//             [--hold 20 --softcut 3] [--textures DIR] preset.milk [more.milk ...] \
//     | ffmpeg -f rawvideo -pix_fmt rgb24 -s 640x360 -r 30 -i - -vf vflip out.mp4
//
// --audio is raw 32-bit float stereo at 44.1 kHz (ffmpeg -f f32le -ac 2 -ar 44100).
// Frames go to stdout as RGB, bottom row first. Time is set from the frame number,
// so the same inputs give the same frames at any rendering speed.
//
// With several presets, each is held for --hold seconds and the next blends in over
// --softcut seconds, the way projectM changes presets when left to itself.

#include <EGL/egl.h>
#include <EGL/eglext.h>

#define GL_GLEXT_PROTOTYPES
#include <GL/gl.h>
#include <GL/glext.h>

#include <projectM-4/projectM.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static void* load_gl(const char* name, void*) {
    return reinterpret_cast<void*>(eglGetProcAddress(name));
}

// A preset that fails to load leaves projectM showing something else. For a
// reference that is worse than no picture, so the render stops.
static bool load_failed = false;

static void switch_failed(const char* preset, const char* message, void*) {
    std::fprintf(stderr, "pm_render: preset failed to load: %s: %s\n", preset, message);
    load_failed = true;
}

[[noreturn]] static void die(const char* what) {
    std::fprintf(stderr, "pm_render: %s (EGL error 0x%x)\n", what, eglGetError());
    std::exit(1);
}

int main(int argc, char** argv) {
    std::string audio_path, textures;
    int width = 640, height = 360, fps = 30;
    double seconds = 30.0, hold = 20.0, softcut = 3.0;
    std::vector<std::string> presets;
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        auto next = [&]() -> const char* {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "pm_render: %s needs a value\n", arg.c_str());
                std::exit(2);
            }
            return argv[++i];
        };
        if (arg == "--audio") audio_path = next();
        else if (arg == "--size") { if (std::sscanf(next(), "%dx%d", &width, &height) != 2) { std::fprintf(stderr, "pm_render: --size WxH\n"); return 2; } }
        else if (arg == "--fps") fps = std::atoi(next());
        else if (arg == "--seconds") seconds = std::atof(next());
        else if (arg == "--hold") hold = std::atof(next());
        else if (arg == "--softcut") softcut = std::atof(next());
        else if (arg == "--textures") textures = next();
        else presets.push_back(arg);
    }
    if (audio_path.empty() || presets.empty() || fps <= 0) {
        std::fprintf(stderr, "usage: pm_render --audio track.f32 [--size WxH] [--fps N] [--seconds S] [--hold S] [--softcut S] [--textures DIR] preset.milk...\n");
        return 2;
    }
    std::FILE* audio = std::fopen(audio_path.c_str(), "rb");
    if (!audio) {
        std::fprintf(stderr, "pm_render: cannot open %s\n", audio_path.c_str());
        return 1;
    }

    // An OpenGL 3.3 core context with no window: Mesa's surfaceless platform.
    EGLDisplay display = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr);
    if (display == EGL_NO_DISPLAY) die("no surfaceless EGL display");
    if (!eglInitialize(display, nullptr, nullptr)) die("eglInitialize failed");
    if (!eglBindAPI(EGL_OPENGL_API)) die("desktop OpenGL is not available through EGL");
    const EGLint config_attributes[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
                                        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_NONE};
    EGLConfig config;
    EGLint count = 0;
    if (!eglChooseConfig(display, config_attributes, &config, 1, &count) || count < 1) die("no EGL config");
    const EGLint context_attributes[] = {EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 3,
                                         EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, context_attributes);
    if (context == EGL_NO_CONTEXT) die("could not create an OpenGL 3.3 core context");
    const EGLint pbuffer_attributes[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
    EGLSurface surface = eglCreatePbufferSurface(display, config, pbuffer_attributes);
    if (!eglMakeCurrent(display, surface, surface, context)) die("eglMakeCurrent failed");
    std::fprintf(stderr, "pm_render: %s\n", reinterpret_cast<const char*>(glGetString(GL_RENDERER)));

    // The picture is drawn into a texture of our own and read back from it.
    GLuint texture = 0, framebuffer = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glGenFramebuffers(1, &framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        std::fprintf(stderr, "pm_render: framebuffer incomplete\n");
        return 1;
    }

    projectm_handle pm = projectm_create_with_opengl_load_proc(load_gl, nullptr);
    if (!pm) {
        std::fprintf(stderr, "pm_render: projectm_create failed\n");
        return 1;
    }
    projectm_set_preset_switch_failed_event_callback(pm, switch_failed, nullptr);
    projectm_set_window_size(pm, static_cast<size_t>(width), static_cast<size_t>(height));
    projectm_set_fps(pm, fps);
    projectm_set_aspect_correction(pm, true);
    // We decide when presets change; projectM's own timer and beat-triggered cuts are off.
    projectm_set_preset_locked(pm, true);
    projectm_set_hard_cut_enabled(pm, false);
    projectm_set_soft_cut_duration(pm, softcut);
    if (!textures.empty()) {
        const char* paths[] = {textures.c_str()};
        projectm_set_texture_search_paths(pm, paths, 1);
    }
    projectm_set_frame_time(pm, 0.0);
    projectm_load_preset_file(pm, presets[0].c_str(), false);

    const int samples_per_frame = 44100 / fps;
    std::vector<float> pcm(static_cast<size_t>(samples_per_frame) * 2);
    std::vector<unsigned char> pixels(static_cast<size_t>(width) * height * 3);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    const long total = static_cast<long>(seconds * fps);
    size_t playing = 0;
    for (long frame = 0; frame < total; ++frame) {
        const double now = static_cast<double>(frame) / fps;
        const size_t due = presets.size() > 1 && hold > 0 ? static_cast<size_t>(now / hold) % presets.size() : 0;
        if (due != playing) {
            playing = due;
            projectm_load_preset_file(pm, presets[playing].c_str(), true);
        }
        const size_t got = std::fread(pcm.data(), sizeof(float) * 2, static_cast<size_t>(samples_per_frame), audio);
        std::fill(pcm.begin() + static_cast<long>(got * 2), pcm.end(), 0.0f);
        projectm_pcm_add_float(pm, pcm.data(), static_cast<unsigned int>(samples_per_frame), PROJECTM_STEREO);
        projectm_set_frame_time(pm, now);
        projectm_opengl_render_frame_fbo(pm, framebuffer);
        if (load_failed) {
            projectm_destroy(pm);
            return 3;
        }
        glBindFramebuffer(GL_READ_FRAMEBUFFER, framebuffer);
        glReadPixels(0, 0, width, height, GL_RGB, GL_UNSIGNED_BYTE, pixels.data());
        if (std::fwrite(pixels.data(), 1, pixels.size(), stdout) != pixels.size()) {
            std::fprintf(stderr, "pm_render: output closed at frame %ld\n", frame);
            break;
        }
    }
    std::fflush(stdout);
    projectm_destroy(pm);
    std::fclose(audio);
    return 0;
}
