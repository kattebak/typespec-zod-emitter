namespace Api {
  model Order { status: Shared.Status; item: Shared.Item; }
}
namespace Shared {
  enum Status { Active, Retired }
  model Base { id: string; }
  model Item extends Base { name: string; }
}
