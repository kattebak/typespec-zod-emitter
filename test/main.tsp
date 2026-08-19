import "@kattebak/typespec-zod-emitter";
import "@typespec/http";

using Http;

enum Status {
	Active,
	Inactive,
	Pending,
}

enum Priority {
	Low: "low",
	Medium: "medium",
	High: "high",
}

model User {
	id: string;
	name: string;
	email: string;
	age?: int32;
	isActive: boolean;
	status: Status;
	priority: Priority;
}

model Post {
	id: string;
	title: string;
	content: string;
	authorId: string;
	tags: string[];
	metadata: Record<string>;
	published: boolean;
	createdAt: utcDateTime;
}

model Address {
	street: string;
	city: string;
	zipCode: string;
	country: string;
}

model Profile {
	userId: string;
	bio?: string;
	avatar?: string;
	address: Address;
	socialLinks: string[];
}

model ApiResponse<T> {
	success: boolean;
	data: T;
	error?: string;
}

// Test generic template - should NOT be emitted
model ResultList<T> {
  continuationToken?: string;
  items: T[];
}

// Test concrete instantiation - SHOULD be emitted
model UserList {
  ...ResultList<User>;
}

// Test anonymous object edge case
model Item {
  id: string;
  name: string;
}

model ItemUpload {
  item: Item;
  // edge case: anonymous object rendered as schema
  urls: {
    s3: string;
  };
}

// Test more complex anonymous objects
model ComplexUpload {
  metadata: {
    author: string;
    tags: string[];
    settings?: {
      visibility: "public" | "private";
      downloadable: boolean;
    };
  };
}

// Test edge case: empty anonymous object
model EmptyObjectTest {
  emptyData: {};
}

// Test lifecycle transformations (Create/Update)
// This tests the edge case where lifecycle-transformed models
// like Create<T> generate inline schemas instead of broken references

model ProductAttribute {
  @visibility(Lifecycle.Read)
  attributeId: string;

  @visibility(Lifecycle.Read)
  productId: string;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  key: string;

  value: string;
}

model Product {
  @visibility(Lifecycle.Read)
  productId: string;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  name: string;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  price: float64;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  inStock: boolean;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  attributes: ProductAttribute[];

  @visibility(Lifecycle.Read)
  createdAt: int64;

  @visibility(Lifecycle.Read)
  updatedAt: int64;
}

// These use lifecycle transforms which create synthetic models
model ProductCreateParams is Create<Product>;
model ProductUpdateParams is Update<Product>;
model ProductAttributeCreateParams is Create<ProductAttribute>;
model ProductAttributeUpdateParams is Update<ProductAttribute>;

// Test edge case: property names that need quoting
model InvalidIdentifiers {
  "kebab-case": string;
  "with space": string;
  "123numeric": string;
  "special@char": string;
  normalKey: string;
}


// Test invalid identifiers in anonymous objects
model AnonymousWithInvalidKeys {
  data: {
    "kebab-case": string;
    "another-kebab": int32;
    validKey: boolean;
  };
}

// Test JavaScript reserved words
model ReservedWords {
  "class": string;
  "const": string;
  "return": string;
  "function": string;
  normalProp: string;
}

// Test url scalar — must emit z.string().url(), not z.string()
model Website {
  homepage: url;
  feed?: url;
}

// Test derived scalar that extends url — must still emit z.string().url()
scalar httpsUrl extends url;

model SecureLink {
  target: httpsUrl;
}

// Test base-model inheritance: a model that `extends` a base must emit ALL
// inherited properties (base + own), with subclass properties overriding on
// a name collision.
model Animal {
  animalId: string;
  legs: int32;
  status: string;
}

model Dog extends Animal {
  breed: string;
  // overrides the inherited `status` (string) with a narrower literal type
  status: "goodBoy";
}

// Regression test: a model-typed property inherited from a base model must
// still be tracked as a topological-sort dependency. `NestedBase` and
// `NestedTarget` live in a namespace that is collected AFTER root-level
// models, so `TopSub` (root-level, extends the namespaced base) is added to
// the emitter's model list before `NestedTarget` is. If the dependency walk
// only looked at `TopSub`'s own properties (missing the inherited `ref`
// property), the topological sort would emit `TopSubSchema` before
// `NestedTargetSchema`, producing a forward reference that throws at import
// time.
namespace OrderingRegression {
  model NestedTarget {
    label: string;
  }

  model NestedBase {
    ref: NestedTarget;
  }
}

model TopSub extends OrderingRegression.NestedBase {
  ownField: string;
}

// HTTP operations drive the emitted operation map and request-validation
// middleware. `Widget` keeps a read-only key, so the create body exercises the
// visibility-filtered payload while `ProductCreateParams` exercises the
// named-schema reference.
model Widget {
  @visibility(Lifecycle.Read)
  widgetId: string;

  name: string;
  quantity: int32;
  tags?: string[];
}

model WidgetUpdateParams is Update<Widget>;

@service(#{ title: "Widget Service" })
@route("/widgets")
namespace Widgets {
  @get
  op list(@query status?: Status): Widget[];

  @post
  op create(@body widget: Widget): Widget;

  @route("/{widgetId}")
  @get
  op read(@path widgetId: string): Widget;

  @route("/{widgetId}")
  @patch
  op update(@path widgetId: string, @body widget: WidgetUpdateParams): Widget;

  @route("/{widgetId}/attachments")
  @post
  op attach(
    @path widgetId: string,
    @header contentType: "text/plain",
    @body contents: string,
  ): void;

  @route("/products")
  @post
  op createProduct(@body product: ProductCreateParams): Product;

  @route("/constrained")
  @post
  op createConstrained(@body payload: Constrained): Constrained;
}

// Test constraint decorators — each must reach the generated zod schema.
// A scalar-level constraint must flow through to every property typed with
// that scalar (the outage this guards against: a 36-char crypto.randomUUID()
// passing a `z.string()` that should have been length-bounded to 25).
@minLength(25)
@maxLength(25)
scalar ShortId extends string;

@format("uuid")
scalar Uuid extends string;

model Constrained {
  id: ShortId;
  externalId: Uuid;

  @minLength(2)
  @maxLength(8)
  nickname: string;

  @pattern("^[A-Z]{2}-\\d{4}$")
  reference: string;

  @format("email")
  contact: string;

  @format("url")
  homepage: string;

  @minValue(1)
  @maxValue(5)
  rating: int32;

  @minValue(0)
  price: float64;

  @maxLength(3)
  code?: string;
}

// A property must be able to narrow the constraints of its own scalar type.
model NarrowedProperty {
  @minLength(4)
  @maxLength(10)
  label: ShortId;
}
