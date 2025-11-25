import { z } from "zod";

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

export const ApiResponseSchema = z.object({
	success: z.boolean(),
	data: z.unknown(),
	error: z.string().optional(),
});
