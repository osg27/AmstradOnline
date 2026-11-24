// DataChannel packet: tag byte 0x02, then 16-bit little-endian SERDAT words
// (data plus stop bits) so 9-bit serial games keep their ninth bit. Packets
// without the tag are legacy single bytes.
const AMIGA_SERIAL_WORDS_TAG = 0x02;

export function encodeAmigaSerialPacket(words) {
  const packet = new Uint8Array(1 + words.length * 2);
  packet[0] = AMIGA_SERIAL_WORDS_TAG;
  words.forEach((word, index) => {
    packet[1 + index * 2] = word & 0xff;
    packet[2 + index * 2] = (word >> 8) & 0x03;
  });
  return packet;
}

export function decodeAmigaSerialPacket(packet) {
  if (packet.length % 2 === 1 && packet[0] === AMIGA_SERIAL_WORDS_TAG) {
    const words = [];
    for (let index = 1; index < packet.length; index += 2) words.push(packet[index] | ((packet[index + 1] & 0x03) << 8));
    return words;
  }
  return Array.from(packet);
}
