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
    time,
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
