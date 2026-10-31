package main

import (
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "os"
 "path/filepath"
 "testing"
 "time"
)

func TestRefreshWritesConfigAndPreservesItOnFailure(t *testing.T) {
 valid := true
 server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  if r.URL.Path != "/v1/router/config" || r.Header.Get("X-Router-Control-Token") != "test-control" { t.Error("incorrect control request"); w.WriteHeader(401); return }
  if !valid { w.WriteHeader(503); return }
  w.Header().Set("Content-Type", "application/json")
  w.Write([]byte(`{"base_url":"https://example.invalid/v1","api_key":"test-only-key","expires_at":"2099-01-01T00:00:00Z","model":"test-model"}`))
 }))
 defer server.Close()
 output := filepath.Join(t.TempDir(), "state", "upstream.json")
 client := &http.Client{Timeout: 5*time.Second}
 if err := refresh(client, server.URL, "shop-01", "test-control", output); err != nil { t.Fatal(err) }
 before, err := os.ReadFile(output); if err != nil { t.Fatal(err) }
 var cfg Config; if err := json.Unmarshal(before, &cfg); err != nil || cfg.APIKey != "test-only-key" { t.Fatal("invalid saved config") }
 info, err := os.Stat(output); if err != nil || info.Mode().Perm() != 0600 { t.Fatal("configuration permissions are not 0600") }
 valid = false
 if err := refresh(client, server.URL, "shop-01", "test-control", output); err == nil { t.Fatal("expected error") }
 after, err := os.ReadFile(output); if err != nil || string(after) != string(before) { t.Fatal("failed refresh modified last config") }
}
