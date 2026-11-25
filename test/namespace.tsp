namespace Api {
  model Order { status: Shared.Status; item: Shared.Item; root: Shared.Node; }
}
namespace Shared {
  enum Status { Active, Retired }
  model Base { id: string; }
  model Item extends Base { name: string; }
  model Node { children: Node[]; }
  model Unused {}
}
