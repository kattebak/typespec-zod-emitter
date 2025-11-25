# TypeSpec Zod Emitter

A custom TypeSpec emitter that generates Zod validators for TypeSpec models using the TypeSpec emitter framework.

## Features

- Generates Zod schemas from TypeSpec models
- Supports all primitive types (string, number, boolean, date)
- Handles complex types (arrays, records, nested objects)
- Enum support with proper typing
- Optional property handling
- Union type support
- TypeScript type inference ready

## Installation

```bash
npm install typespec-zod-emitter zod
```

## Usage

### 1. Define TypeSpec Models

```typespec
import "typespec-zod-emitter";

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
```

### 2. Configure tspconfig.yaml

```yaml
emit:
  - typespec-zod-emitter
options:
  typespec-zod-emitter:
    output-file: "schemas.ts"
    package-name: "my-api"
    package-version: "1.0.0"
```

### 3. Compile

```bash
npx tsp compile .
```

### 4. Generated Output (schemas.ts)

```typescript
import { z } from "zod";

/**
 * Package: my-api
 * Version: 1.0.0
 */

export const StatusSchema = z.enum(["Active", "Inactive", "Pending"]);

export const PrioritySchema = z.enum(["low", "medium", "high"]);

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  age: z.number().optional(),
  isActive: z.boolean(),
  status: StatusSchema,
  priority: PrioritySchema,
});

export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.string()),
  published: z.boolean(),
  createdAt: z.date(),
});

export const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  zipCode: z.string(),
  country: z.string(),
});

export const ProfileSchema = z.object({
  userId: z.string(),
  bio: z.string().optional(),
  avatar: z.string().optional(),
  address: AddressSchema,
  socialLinks: z.array(z.string()),
});
```

### 5. Generated Package Files

When both `package-name` and `package-version` are provided, a complete npm package is automatically generated with the following files:

#### package.json

```json
{
  "name": "my-api",
  "version": "1.0.0",
  "type": "module",
  "main": "./schemas.js",
  "types": "./schemas.d.ts",
  "exports": {
    ".": {
      "types": "./schemas.d.ts",
      "default": "./schemas.js"
    }
  },
  "peerDependencies": {
    "zod": "^3.0.0"
  }
}
```

#### README.md

A generated README with installation instructions, usage examples, and a list of all available schemas.

#### tsconfig.json

TypeScript configuration optimized for ES modules with declaration file generation.

#### .npmignore

Configured to exclude source files and development artifacts from the published package.

### 6. Building the Package

To compile the TypeScript schemas to JavaScript:

```bash
cd tsp-output/@kattebak/typespec-zod-emitter
npm install zod typescript
npx tsc
```

This generates:

- `schemas.js` - Compiled JavaScript
- `schemas.d.ts` - TypeScript declarations
- `schemas.d.ts.map` - Declaration source maps
- `schemas.js.map` - JavaScript source maps

The package is now ready to be published to npm or consumed locally.

### 7. Use the Generated Schemas

```typescript
import { UserSchema, PostSchema } from "./schemas";

const userData = {
  id: "123",
  name: "John Doe",
  email: "john@example.com",
  isActive: true,
  status: "Active",
  priority: "high",
};

const validatedUser = UserSchema.parse(userData);

const postData = {
  id: "post-1",
  title: "My First Post",
  content: "Hello World",
  authorId: "123",
  tags: ["intro", "hello"],
  metadata: { category: "blog" },
  published: true,
  createdAt: new Date(),
};

const validatedPost = PostSchema.parse(postData);

type User = z.infer<typeof UserSchema>;
type Post = z.infer<typeof PostSchema>;
```

## Configuration Options

- `output-file`: Name of the output file (default: "schemas.ts")
- `output-dir`: Output directory (defaults to emitter output directory)
- `package-name`: Package name to include in generated file header (optional)
- `package-version`: Package version to include in generated file header (optional)

**Note:** When both `package-name` and `package-version` are provided, the emitter generates a complete npm package with:

- `package.json` - Package manifest with proper ES module configuration
- `README.md` - Auto-generated documentation with usage examples
- `tsconfig.json` - TypeScript configuration for building the package
- `.npmignore` - Excludes development files from npm publish

## Supported TypeSpec Types

### Primitives

- `string` → `z.string()`
- `int32`, `int64`, `float`, `number` → `z.number()`
- `boolean` → `z.boolean()`
- `utcDateTime`, `offsetDateTime`, `plainDate`, `plainTime` → `z.date()`
- `url` → `z.string().url()`

### Complex Types

- `Array<T>` or `T[]` → `z.array(T)`
- `Record<string>` → `z.record(z.string(), z.string())`
- Nested objects → Referenced schemas
- Anonymous objects → Inline `z.object({...})`
- Enums → `z.enum([...])`
- Unions → `z.union([...])`
- Optional properties → `.optional()`

### Anonymous Object Literals

Anonymous object types are converted to inline Zod objects:

```typespec
model ItemUpload {
  item: Item;
  urls: {
    s3: string;
    cloudfront?: string;
  };
}
```

Generates:

```typescript
export const ItemUploadSchema = z.object({
  item: ItemSchema,
  urls: z.object({ s3: z.string(), cloudfront: z.string().optional() }),
});
```

This works for deeply nested anonymous objects as well.

## Limitations

### Generic/Template Models

The emitter focuses on plain, concrete models and **does not emit** generic template declarations. For example:

```typespec
// This will NOT be emitted (template declaration)
model ResultList<T> {
  @continuationToken continuationToken?: string;
  items: T[];
}

// This WILL be emitted (concrete model)
model UserResultList {
  ...ResultList<User>;
}
```

**Reason:** Generic types with unbound type parameters cannot be directly converted to Zod schemas since Zod requires concrete types. The emitter skips these to avoid generating broken schemas.

**Workaround:** Create concrete instantiations of generic templates using the spread operator (`...`) as shown above, or define your models without generic parameters.
