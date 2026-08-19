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
- Request-validation middleware for generated HTTP clients

## Installation

```bash
npm install typespec-zod-emitter zod@^3.23.0
```

## Zod compatibility

The emitter targets **zod 3**, and both the emitter and every generated package
declare the peer range `^3.23.0`.

The generated schemas call the string format checks `.url()` and `.datetime()`,
which zod 4 removed, and `.date()` and `.time()`, which arrived in zod 3.23. So
the range is capped below 4 and floored at 3.23. Emitting the zod 4 spellings
instead would break every consumer on zod 3, which is why the range moves rather
than the output.

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
  createdAt: z.string().datetime(),
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
  "scripts": {
    "prepare": "tsc"
  },
  "peerDependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
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

The generated package includes a `prepare` script that runs `tsc` automatically after `npm install`, so consumers get compiled output out of the box:

```bash
cd tsp-output/@kattebak/typespec-zod-emitter
npm install
```

This automatically generates:

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
  createdAt: new Date().toISOString(),
};

const validatedPost = PostSchema.parse(postData);

type User = z.infer<typeof UserSchema>;
type Post = z.infer<typeof PostSchema>;
```

## Request Validation

When the spec defines HTTP operations (`@typespec/http`), the emitter also writes
`middleware.ts`: an operation map and a request-validation middleware for an
openapi-generator `typescript-fetch` client.

Every operation carries its method, route, a path matcher and the zod schemas for
its JSON request body and its path, query, header and cookie parameters. The
request body schema follows the operation's request visibility, so read-only
properties are absent from a create body and a `PATCH` body is optional
throughout.

```typescript
export const operations: readonly OperationSchemas[] = [
  {
    operationId: "Widgets_create",
    method: "POST",
    path: "/widgets",
    pattern: /^.*\/widgets\/?$/,
    pathParameterNames: [],
    body: z.object({ name: z.string(), quantity: z.number() }),
    parameters: {},
  },
];
```

Attach the middleware to the generated client and every JSON request body is
validated before the request is sent:

```typescript
import { Configuration, WidgetsApi } from "./generated-client";
import { validationMiddleware } from "@mycorp/zod-schemas/middleware";

const widgets = new WidgetsApi(
  new Configuration({ basePath, middleware: [validationMiddleware] }),
);
```

A valid body is passed through untouched. An invalid one rejects the call with a
`RequestValidationError` carrying the zod `issues`, and no request goes out.
Requests the map does not cover, non-JSON bodies and operations without a request
body are left alone.

Validation is on by default. `createValidationMiddleware({ validate: false })`
attaches the middleware with validation turned off, and the `emit-middleware`
option turns the whole output file off.

## Configuration Options

- `output-file`: Name of the output file (default: "schemas.ts")
- `output-dir`: Output directory (defaults to emitter output directory)
- `package-name`: Package name to include in generated file header (optional)
- `package-version`: Package version to include in generated file header (optional)
- `emit-middleware`: Emit the operation map and request-validation middleware (default: `true`)
- `middleware-file`: Name of the middleware output file (default: "middleware.ts")

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
- `utcDateTime` → `z.string().datetime()`
- `offsetDateTime` → `z.string().datetime({ offset: true })`
- `plainDate` → `z.string().date()`
- `plainTime` → `z.string().time()`
- `duration` → `z.string()`
- `url` → `z.string().url()`
- `bytes` → `z.instanceof(Uint8Array)`

### Constraints

- `@minLength` / `@maxLength` → `.min()` / `.max()`
- `@pattern` → `.regex()`
- `@format` → `.uuid()`, `.url()` (also `uri`), `.email()`; any other format is ignored
- `@minValue` / `@maxValue` → `.min()` / `.max()`

Constraints declared on a scalar apply to every property typed with it, and a
property can narrow them:

```typespec
@minLength(25)
@maxLength(25)
scalar ShortId extends string;

model Order {
  orderId: ShortId;

  @minValue(1)
  @maxValue(5)
  rating: int32;
}
```

Generates:

```typescript
export const OrderSchema = z.object({
  orderId: z.string().min(25).max(25),
  rating: z.number().min(1).max(5),
});
```

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
