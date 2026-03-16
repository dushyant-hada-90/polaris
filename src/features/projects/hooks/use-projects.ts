import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api"
import { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@clerk/nextjs";

export const useProject = (projectId: Id<"projects">) => {
    return useQuery(api.projects.getById, { id: projectId });
}

export const useProjects = () => {
    return useQuery(api.projects.get);
}

export const useProjectsPartial = (limit: number) => {
    return useQuery(api.projects.getPartial, {
        limit,
    });
}

export const useCreateProject = () => {

    const { userId } = useAuth()

    return useMutation(api.projects.create).withOptimisticUpdate(
        (localStore, args) => {
            const now = Date.now()
            const newProject = {
                _id: crypto.randomUUID() as Id<"projects">,
                _creationTime: now,
                name: args.name,
                ownerId: userId ?? "anonymous",
                updatedAt: now
            }

            // Update the full list cache
            const existingProjects = localStore.getQuery(api.projects.get, {})
            if (existingProjects !== undefined) {
                localStore.setQuery(api.projects.get, {}, [
                    newProject,
                    ...existingProjects,
                ])
            }

            // Update the partial list cache (ProjectsList uses limit=6)
            const existingPartial = localStore.getQuery(api.projects.getPartial, { limit: 6 })
            if (existingPartial !== undefined) {
                localStore.setQuery(api.projects.getPartial, { limit: 6 }, [
                    newProject,
                    ...existingPartial,
                ].slice(0, 6))
            }
        }
    )
}

export const useRenameProject = (projectId: Id<"projects">) => {

    return useMutation(api.projects.rename).withOptimisticUpdate(
        (localStore, args) => {
            // Update the full list cache
            const existingProject = localStore.getQuery(api.projects.getById, {
                id: projectId
            })

            if (existingProject !== undefined && existingProject !== null) {
                localStore.setQuery(api.projects.getById, {
                    id: projectId
                }, {
                    ...existingProject,
                    name: args.name,
                    updatedAt: Date.now()
                })
            }

            const existingProjects = localStore.getQuery(api.projects.get, {});

            if (existingProjects !== undefined) {
                localStore.setQuery(
                    api.projects.get,
                    {},
                    existingProjects.map((project) => {
                        return project._id === args.id
                            ? { ...project, name: args.name, updatedAt: Date.now() }
                            : project
                    })
                )
            }

            const existingPartial = localStore.getQuery(api.projects.getPartial, { limit: 6 });

            if (existingPartial !== undefined) {
                localStore.setQuery(
                    api.projects.getPartial,
                    { limit: 6 },
                    existingPartial.map((project) => {
                        return project._id === args.id
                            ? { ...project, name: args.name, updatedAt: Date.now() }
                            : project
                    })
                )
            }
        }
    )
}

export const useUpdateProjectSettings = () => {
    // todo add optimistic mutation
    return useMutation(api.projects.updateSettings)
}