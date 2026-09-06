package replay

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestBrowserFormatAgainstWazero(t *testing.T) {
	root := filepath.Join("..", "..")
	path := filepath.Join(t.TempDir(), "replay.json")
	cmd := exec.Command("node", "tests/replay-fixture.mjs", path)
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generate JS oracle: %v: %s", err, out)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err := Decode(strings.NewReader(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	wasm, err := os.ReadFile(filepath.Join(root, "public", "simulation.wasm"))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(filepath.Join(root, "public", "build.json"))
	if err != nil {
		t.Fatal(err)
	}
	var identity Identity
	if err = json.Unmarshal(manifest, &identity); err != nil {
		t.Fatal(err)
	}
	result, err := Validate(context.Background(), wasm, identity, r)
	if err != nil {
		t.Fatal(err)
	}
	if result.Ticks != 3600 || result.Hash != r.Checkpoints[len(r.Checkpoints)-1].Hash {
		t.Fatalf("different JS and Go result: %+v", result)
	}
	for name, mutate := range map[string]func(*Recording){
		"identity":         func(r *Recording) { r.Identity.Map = "wrong" },
		"input":            func(r *Recording) { r.Inputs[0] = []int{16, 0} },
		"pair length":      func(r *Recording) { r.Inputs[0] = []int{0} },
		"initial":          func(r *Recording) { r.Initial[0] ^= 1 },
		"checkpoint hash":  func(r *Recording) { r.Checkpoints[0].Hash = "1" },
		"checkpoint bytes": func(r *Recording) { r.Checkpoints[0].State[0] ^= 1 },
		"checkpoint order": func(r *Recording) { r.Checkpoints[1].Tick = 60 },
	} {
		t.Run(name, func(t *testing.T) {
			copy, err := Decode(strings.NewReader(string(data)))
			if err != nil {
				t.Fatal(err)
			}
			mutate(&copy)
			if _, err = Validate(context.Background(), wasm, identity, copy); err == nil {
				t.Fatal("accepted corrupt replay")
			}
		})
	}
	if _, err := Validate(context.Background(), append([]byte{0}, wasm...), identity, r); err == nil {
		t.Fatal("accepted wrong artifact")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Validate(ctx, wasm, identity, r); err == nil {
		t.Fatal("ignored cancellation")
	}
}

func TestDecodeRejectsMalformedJSON(t *testing.T) {
	for _, raw := range []string{`{} {}`, `{"seed":-1}`, `{"initial":[1.5]}`, `{"inputs":[[1.2,0]]}`} {
		if _, err := Decode(strings.NewReader(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}
