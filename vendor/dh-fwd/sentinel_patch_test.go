package main

import (
	"net"
	"strings"
	"testing"
	"time"
)

// SENTINEL vendor patch tests — /info/device read past interleaved replies.

// scriptedInfoPeer answers /probe/device with a bare 200 and /info/device
// with the given datagrams, in order (several datagrams = interleaving).
func scriptedInfoPeer(t *testing.T, infoReplies ...string) int {
	t.Helper()
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Skipf("udp listen: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	go func() {
		buf := make([]byte, 65536)
		for {
			conn.SetReadDeadline(time.Now().Add(10 * time.Second))
			n, addr, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			raw := string(buf[:n])
			switch {
			case strings.Contains(raw, "/probe/device/"):
				conn.WriteToUDP([]byte(dhAck(raw, "200 OK", "")), addr)
			case strings.Contains(raw, "/info/device/"):
				for _, r := range infoReplies {
					conn.WriteToUDP([]byte(r), addr)
				}
			}
		}
	}()
	return conn.LocalAddr().(*net.UDPAddr).Port
}

// A stray reply delivered before the Info-bearing one must not hide the
// blob: the salt is recovered from the SECOND datagram.
func TestProbeDeviceInfoSkipsInterleavedReply(t *testing.T) {
	stray := "HTTP/1.1 200 OK\r\n\r\n<body><Status>online</Status></body>"
	good := "HTTP/1.1 200 OK\r\n\r\n<body><Info>" +
		encryptDevInfoInfo([]byte(`{"randsalt":"L4T3S4LT","httpport":80}`)) + "</Info></body>"
	port := scriptedInfoPeer(t, stray, good)

	u := NewUDP("127.0.0.1", port, false, dmssProfile)
	defer u.Close()
	salt, err := resolveAutoSalt(dmssProfile, 1, "", probeDeviceInfo(u, "SN"), func(string, ...any) {})
	if err != nil || salt != "L4T3S4LT" {
		t.Fatalf("salt=%q err=%v, want L4T3S4LT/nil", salt, err)
	}
}

// A device that publishes no Info blob still fails closed, promptly (grace
// window, not the full read timeout), and the error names the reply shape.
func TestProbeDeviceInfoNoBlobFailsClosedWithDiagnostic(t *testing.T) {
	port := scriptedInfoPeer(t, "HTTP/1.1 200 OK\r\n\r\n<body><DevVersion>1.0</DevVersion></body>")

	origGrace := infoProbeGrace
	infoProbeGrace = 200 * time.Millisecond
	defer func() { infoProbeGrace = origGrace }()

	u := NewUDP("127.0.0.1", port, false, dmssProfile)
	defer u.Close()
	start := time.Now()
	payload := probeDeviceInfo(u, "SN")
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("probe took %v, want the short grace window", elapsed)
	}
	salt, err := resolveAutoSalt(dmssProfile, 1, "", payload, func(string, ...any) {})
	if err == nil {
		t.Fatalf("salt=%q, want fail-closed error", salt)
	}
	if !strings.Contains(err.Error(), "200 OK") || !strings.Contains(err.Error(), "DevVersion") {
		t.Fatalf("error %q lacks the reply shape", err)
	}
	if strings.Contains(err.Error(), "1.0") {
		t.Fatalf("error %q leaks a field value", err)
	}
}
