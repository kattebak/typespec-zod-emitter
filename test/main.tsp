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
