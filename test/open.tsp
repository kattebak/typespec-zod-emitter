import "./main.tsp";
enum Revision { First: 1, Second: 2 }
model WireBase { id: string; }
model WireA extends WireBase { kind: "A"; label: string; }
model WireB { ...WireBase; kind: "B"; status: Status; revision: Revision; }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Wire { A: WireA, B: WireB }
