const plainRe =
  /^(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\.\d+)?\s+from\s+(?:(tcp|udp):)?([0-9a-fA-F:.]+):\d+\s+accepted\s+(tcp|udp):([^:\s]+):(\d+)\s+\[([^\]]+)\]\s+email:\s+(?:\d+\.)?([^\s]+)\s*$/;

function splitInboundOutbound(bracket) {
  const arrow = bracket.includes('>>') ? '>>' : (bracket.includes('->') ? '->' : null);
  if (!arrow) return { inbound: bracket.trim(), outbound: '' };
  const [inb, outb] = bracket.split(arrow);
  return { inbound: (inb || '').trim(), outbound: (outb || '').trim() };
}

export function parseLine(line) {
  if (!line || line.includes(' DOH//') || line.includes(' got answer:')) return null;

  const m = line.match(plainRe);
  if (!m) return null;

  const [
    _,
    date,        // 1
    time,        // 2
    protoIn,     // 3 (tcp|udp|undefined)
    userIp,      // 4
    protoOut,    // 5 (tcp|udp)
    target,      // 6
    portStr,     // 7
    bracket,     // 8
    username,    // 9 — without "digits."
  ] = m;

  const { inbound, outbound } = splitInboundOutbound(bracket);

  return {
    date,
    time, 
    protocol_in: protoIn || null,
    protocol_out: protoOut.toLowerCase(),
    user_ip: userIp,
    target,
    port: Number(portStr),
    inbound,
    outbound,
    xray_user_after_dot: username,
  };
}