// Parser for plain access.log lines (with optional microseconds)
// Examples:
// 2025/07/24 16:34:37.777007 from 213.87.133.176:7616 accepted tcp:www.google.com:443 [VLESS TCP REALITY >> DIRECT] email: 412.6218924756_RykO
// 2025/07/24 16:34:39 from tcp:46.138.157.205:2414 accepted udp:239.255.255.250:1900 [VLESS TCP REALITY -> BLOCK] email: 4849.7556515598_D8T8
const plainRe = /^(\d{4}\/\d{2}\/\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? from (?:(tcp|udp):)?([0-9a-fA-F:.]+):\d+ accepted (tcp|udp):([^:\s]+):(\d+) \[([^\]]+)\] email: (\d+)\.([^\s]+)$/;

function splitInboundOutbound(bracket) {
  const arrow = bracket.includes('>>') ? '>>' : (bracket.includes('->') ? '->' : null);
  if (!arrow) return { inbound: bracket.trim(), outbound: '' };
  const [inb, outb] = bracket.split(arrow);
  return { inbound: (inb || '').trim(), outbound: (outb || '').trim() };
}

export function parseLine(line) {
  if (line.includes(' DOH//') || line.includes(' got answer:')) return null;
  const m = line.match(plainRe);
  if (!m) return null;
  const [
    _,
    date,
    time,
    protoIn,
    userIp,
    protoOut,
    target,
    portStr,
    bracket,
    /* userPrefix */,
    userAfterDot,
  ] = m;

  const { inbound, outbound } = splitInboundOutbound(bracket);

  return {
    date,
    time, // already without microseconds
    protocol_in: protoIn || null,
    protocol_out: protoOut.toLowerCase(),
    user_ip: userIp,
    target,
    port: Number(portStr),
    inbound,
    outbound,
    xray_user_after_dot: userAfterDot,
  };
}
