package vision

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"swarmbuild/internal/wire"
	"time"

	"github.com/chromedp/chromedp"
)

// DefaultChromePath is the macOS Chrome binary used when none is configured. On
// macOS there is no `google-chrome` on PATH, so chromedp's auto-discovery fails;
// pointing it at the app bundle's binary is the reliable path (the bake env probe).
// A caller may override via RenderConfig.ChromePath or the CHROME_PATH env var.
const DefaultChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

// RenderConfig drives the headless render of one Build spec against the real
// Scene3D (the bake-harness web entry). It is LAB/BAKE-ONLY; nothing on the
// headline constructs it.
type RenderConfig struct {
	// WebDistDir is the built web bundle directory (output of `npm run build`) that
	// contains bake-harness.html and its assets. The harness serves it locally.
	WebDistDir string
	// ChromePath is the absolute path to a headless-capable Chrome/Chromium binary.
	// Empty ⇒ CHROME_PATH env var, then DefaultChromePath.
	ChromePath string
	// Width/Height are the screenshot viewport. Zero ⇒ 1024×768 (a square-ish
	// framing that captures the fixed Scene3D camera's worksite view).
	Width, Height int
	// Timeout bounds the whole render (server up → page ready → screenshot). Zero ⇒
	// 30s.
	Timeout time.Duration
	// SettleDelay is an extra wait after the page signals __BAKE_READY__, to let the
	// WebGL canvas finish its first paint. Zero ⇒ 600ms.
	SettleDelay time.Duration
}

func (c RenderConfig) chromePath() string {
	if c.ChromePath != "" {
		return c.ChromePath
	}
	if env := os.Getenv("CHROME_PATH"); env != "" {
		return env
	}
	return DefaultChromePath
}

func (c RenderConfig) size() (int, int) {
	w, h := c.Width, c.Height
	if w <= 0 {
		w = 1024
	}
	if h <= 0 {
		h = 768
	}
	return w, h
}

func (c RenderConfig) timeout() time.Duration {
	if c.Timeout <= 0 {
		return 30 * time.Second
	}
	return c.Timeout
}

func (c RenderConfig) settle() time.Duration {
	if c.SettleDelay <= 0 {
		return 600 * time.Millisecond
	}
	return c.SettleDelay
}

// Render builds a deterministic screenshot of ops rendered on the real Scene3D: it
// serves the bake-harness bundle on an ephemeral local port (injecting the spec at
// /spec.json), drives headless Chrome to load the page, waits for the canvas to
// settle, and returns the PNG bytes. It makes NO model call (that is
// ScoreSilhouette's job) and is the only browser-touching code in the package.
//
// taskType is carried into the synthetic snapshot so the harness renders the right
// tier. Render is a manual/live bake step: the unit suite uses a committed sample
// screenshot instead (no browser in `go test`).
func Render(ctx context.Context, cfg RenderConfig, taskType string, ops []wire.BuildOp) ([]byte, error) {
	if cfg.WebDistDir == "" {
		return nil, errors.New("vision: RenderConfig.WebDistDir is required (run `npm run build` in web/)")
	}
	if _, err := os.Stat(filepath.Join(cfg.WebDistDir, "bake-harness.html")); err != nil {
		return nil, fmt.Errorf("vision: bake-harness.html not found in %q (build the web bundle): %w", cfg.WebDistDir, err)
	}

	specPayload, err := json.Marshal(map[string]any{"ops": ops, "task_type": taskType})
	if err != nil {
		return nil, fmt.Errorf("vision: marshal spec payload: %w", err)
	}

	// Serve the built bundle + the injected /spec.json on an ephemeral loopback port.
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("vision: open local listener: %w", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/spec.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(specPayload)
	})
	mux.Handle("/", http.FileServer(http.Dir(cfg.WebDistDir)))
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	defer func() {
		shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()

	url := fmt.Sprintf("http://%s/bake-harness.html", ln.Addr().String())
	w, h := cfg.size()

	ctx, cancel := context.WithTimeout(ctx, cfg.timeout())
	defer cancel()

	allocOpts := append([]chromedp.ExecAllocatorOption{},
		chromedp.ExecPath(cfg.chromePath()),
		chromedp.Headless,
		chromedp.DisableGPU,
		chromedp.NoSandbox,
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("force-color-profile", "srgb"),
		chromedp.WindowSize(w, h),
	)
	allocCtx, cancelAlloc := chromedp.NewExecAllocator(ctx, allocOpts...)
	defer cancelAlloc()
	cdpCtx, cancelCDP := chromedp.NewContext(allocCtx)
	defer cancelCDP()

	var png []byte
	runErr := chromedp.Run(cdpCtx,
		chromedp.EmulateViewport(int64(w), int64(h)),
		chromedp.Navigate(url),
		// Wait for the harness to signal the canvas has painted a few frames.
		chromedp.Poll("window.__BAKE_READY__ === true", nil, chromedp.WithPollingTimeout(cfg.timeout())),
		chromedp.Sleep(cfg.settle()),
		chromedp.CaptureScreenshot(&png),
	)
	if runErr != nil {
		return nil, fmt.Errorf("vision: headless render failed (chrome=%q): %w", cfg.chromePath(), runErr)
	}
	if len(png) == 0 {
		return nil, errors.New("vision: headless render produced an empty screenshot")
	}
	return png, nil
}

// RenderAndScore is the full bake-time vision pass for one spec: render the real
// Scene3D headless, screenshot it, and score the silhouette through the vision
// model. It is the single entry point cmd/bake calls. Either step failing yields
// ErrVisionUnavailable (wrapping the cause) so the bake degrades gracefully and
// caches the spec with the silhouette dimension left unscored (ADR-0008).
func RenderAndScore(ctx context.Context, m Model, cfg RenderConfig, intent Intent, ops []wire.BuildOp) (Score, error) {
	png, err := Render(ctx, cfg, intent.TaskType, ops)
	if err != nil {
		return Score{}, fmt.Errorf("%w: render: %w", ErrVisionUnavailable, err)
	}
	return ScoreSilhouette(ctx, m, png, intent)
}

// IsChromeAvailable reports whether a usable Chrome binary is present at the
// configured path, so cmd/bake can decide whether to run the live vision pass or
// skip it (and cache without a silhouette score). It does not launch Chrome.
func IsChromeAvailable(cfg RenderConfig) bool {
	p := cfg.chromePath()
	if strings.TrimSpace(p) == "" {
		return false
	}
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}
