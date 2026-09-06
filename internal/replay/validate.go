// Package replay validates rule-consistent recordings against the shipped WASM.
package replay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"strconv"

	"github.com/tetratelabs/wazero"
)

const StateBytes = 8384
const MaxJSONBytes = 110 << 20

type Identity struct {
	Protocol int    `json:"protocol"`
	ABI      int    `json:"abi"`
	WASM     string `json:"wasm"`
	Map      string `json:"map"`
	Config   string `json:"config"`
}

// Arrays decode numeric JSON bytes, never Go's base64 []byte representation.
type Recording struct {
	Version     int          `json:"version"`
	Identity    Identity     `json:"identity"`
	Seed        uint32       `json:"seed"`
	MapMode     int          `json:"mapMode"`
	Initial     []int        `json:"initial"`
	Inputs      [][]int      `json:"inputs"`
	Checkpoints []Checkpoint `json:"checkpoints"`
}
type Checkpoint struct {
	Tick  int    `json:"tick"`
	Hash  string `json:"hash"`
	State []int  `json:"state"`
}
type Result struct {
	Ticks  int      `json:"ticks"`
	Hash   string   `json:"hash"`
	Winner int32    `json:"winner"`
	Scores [2]int32 `json:"scores"`
}

func Decode(reader io.Reader) (Recording, error) {
	var r Recording
	data, err := io.ReadAll(io.LimitReader(reader, MaxJSONBytes+1))
	if err != nil {
		return r, err
	}
	if len(data) > MaxJSONBytes {
		return r, fmt.Errorf("replay exceeds size limit")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return r, err
	}
	for _, key := range []string{"version", "identity", "seed", "mapMode", "initial", "inputs", "checkpoints"} {
		if value, ok := fields[key]; !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return r, fmt.Errorf("missing replay field %s", key)
		}
	}
	err = json.Unmarshal(data, &r)
	return r, err
}

func snapshot(values []int) ([]byte, error) {
	if len(values) != StateBytes {
		return nil, fmt.Errorf("invalid snapshot length")
	}
	out := make([]byte, StateBytes)
	for i, v := range values {
		if v < 0 || v > 255 {
			return nil, fmt.Errorf("invalid snapshot byte")
		}
		out[i] = byte(v)
	}
	return out, nil
}

func Validate(ctx context.Context, wasm []byte, identity Identity, r Recording) (Result, error) {
	var result Result
	if r.Version != 1 || r.Identity != identity || identity.Protocol != 1 || identity.ABI != 1 {
		return result, fmt.Errorf("replay identity mismatch")
	}
	if fmt.Sprintf("%x", sha256.Sum256(wasm)) != identity.WASM {
		return result, fmt.Errorf("WASM digest mismatch")
	}
	if (r.MapMode != 0 && r.MapMode != 32768) || len(r.Inputs) > 216000 || len(r.Checkpoints) > 3601 {
		return result, fmt.Errorf("invalid replay bounds")
	}
	initial, err := snapshot(r.Initial)
	if err != nil {
		return result, err
	}
	for _, pair := range r.Inputs {
		if len(pair) != 2 || pair[0] < 0 || pair[0] > 15 || pair[1] < 0 || pair[1] > 15 {
			return result, fmt.Errorf("invalid paired input")
		}
	}
	previous := 0
	for _, cp := range r.Checkpoints {
		if cp.Tick <= previous || cp.Tick > len(r.Inputs) {
			return result, fmt.Errorf("invalid checkpoint tick")
		}
		if _, err := strconv.ParseInt(cp.Hash, 10, 64); err != nil {
			return result, fmt.Errorf("invalid checkpoint hash")
		}
		if _, err := snapshot(cp.State); err != nil {
			return result, err
		}
		previous = cp.Tick
	}
	runtime := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithMemoryLimitPages(4).WithCloseOnContextDone(true))
	defer runtime.Close(context.Background())
	module, err := runtime.InstantiateWithConfig(ctx, wasm, wazero.NewModuleConfig().WithStartFunctions())
	if err != nil {
		return result, err
	}
	call := func(name string, args ...uint64) (uint64, error) {
		fn := module.ExportedFunction(name)
		if fn == nil {
			return 0, fmt.Errorf("missing export %s", name)
		}
		values, err := fn.Call(ctx, args...)
		if err != nil {
			return 0, err
		}
		if len(values) != 1 {
			return 0, fmt.Errorf("invalid export %s", name)
		}
		return values[0], nil
	}
	if v, err := call("init", 1024, uint64(r.MapMode), uint64(r.Seed)); err != nil || v != 1 {
		return result, fmt.Errorf("simulation initialization failed: %v", err)
	}
	memory := module.Memory()
	if memory == nil {
		return result, fmt.Errorf("missing memory")
	}
	save := func() ([]byte, error) {
		if v, err := call("save_state", 65536); err != nil || v != StateBytes {
			return nil, fmt.Errorf("snapshot failed: %v", err)
		}
		state, ok := memory.Read(65536, StateBytes)
		if !ok {
			return nil, fmt.Errorf("snapshot outside memory")
		}
		return state, nil
	}
	state, err := save()
	if err != nil {
		return result, err
	}
	if !bytes.Equal(state, initial) {
		return result, fmt.Errorf("initial state differs from match configuration")
	}
	checkpoint := 0
	for tick, pair := range r.Inputs {
		if !memory.Write(2048, []byte{byte(pair[0]), byte(pair[1])}) {
			return result, fmt.Errorf("input outside memory")
		}
		if v, err := call("step", 2048, 1); err != nil || v != 1 {
			return result, fmt.Errorf("step %d failed: %v", tick, err)
		}
		if checkpoint < len(r.Checkpoints) && r.Checkpoints[checkpoint].Tick == tick+1 {
			cp := r.Checkpoints[checkpoint]
			hash, err := call("state_hash")
			if err != nil {
				return result, err
			}
			state, err := save()
			if err != nil {
				return result, err
			}
			expected, _ := snapshot(cp.State)
			if strconv.FormatInt(int64(hash), 10) != cp.Hash || !bytes.Equal(state, expected) {
				return result, fmt.Errorf("replay diverges at tick %d", tick+1)
			}
			checkpoint++
		}
	}
	hash, err := call("state_hash")
	if err != nil {
		return result, err
	}
	state, err = save()
	if err != nil {
		return result, err
	}
	result = Result{Ticks: len(r.Inputs), Hash: strconv.FormatInt(int64(hash), 10), Winner: int32(binary.LittleEndian.Uint32(state[4:])), Scores: [2]int32{int32(binary.LittleEndian.Uint32(state[108:])), int32(binary.LittleEndian.Uint32(state[172:]))}}
	return result, nil
}
