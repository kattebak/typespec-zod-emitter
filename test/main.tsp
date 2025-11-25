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
