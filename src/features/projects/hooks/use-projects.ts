import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api"
import { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@clerk/nextjs";

export const useProjects = () => {
    return useQuery(api.projects.get);
}

export const useProjectsPartial = (limit: number) => {
    return useQuery(api.projects.getPartial, {
        limit,
    });
}

export const useCreateProject = () => {

    const {userId} = useAuth()

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