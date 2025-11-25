import "@kattebak/typespec-zod-emitter";

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
