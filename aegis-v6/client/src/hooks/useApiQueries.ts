/**
 * useApiQueries custom React hook (api queries logic).
 *
 * - Used by React components that need this functionality */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  apiGetReports,
  apiGetAlerts,
  apiGetPredictions,
  apiGetUsers,
  apiGetAuditLog,
  apiGetHeatmapData,
  apiGetDeployments,
  apiGetCommandCenterAnalytics,
  apiGetNews,
  apiCreateAlert,
  apiDeployResources,
  apiRecallResources,
  type NewsItem,
  type Prediction,
  type Deployment,
  type AuditEntry,
} from '../utils/api'
import type { Report, Alert } from '../types'

//Query Keys: stable references used by React Query to identify cache entries.
//Each unique key points to one cached result.  Components elsewhere can call
//queryClient.invalidateQueries({ queryKey: queryKeys.reports }) to force a
//re-fetch after a mutation (e.g. after submitting a new report).
export const queryKeys = {
  reports: ['reports'] as const,
  alerts: ['alerts'] as const,
  predictions: ['predictions'] as const,
  users: ['users'] as const,
  //Audit log includes filters in the key so different filter combinations
  //get their own separate cache entry instead of sharing one.
  auditLog: (filters?: Record<string, string>) => ['auditLog', filters] as const,
  heatmap: ['heatmap'] as const,
  deployments: ['deployments'] as const,
  analytics: ['analytics'] as const,
  //News key includes the includeArchived flag so archived vs live lists are
  //cached separately.
  news: (includeArchived?: boolean) => ['news', includeArchived] as const,
}

//Reports
export function useReportsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports,
    queryFn: apiGetReports,
    enabled,
    //staleTime = how long the cached data is considered fresh (milliseconds).
    //10 000 ms = 10 seconds: components that mount within 10s of the last
    //fetch reuse the cached data instead of hitting the server again.
    staleTime: 10 * 1000, // Reports refresh more frequently
  })
}

//Alerts
export function useAlertsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.alerts,
    queryFn: apiGetAlerts,
    enabled,
    staleTime: 10 * 1000,
  })
}

//AI Predictions
export function usePredictionsQuery(enabled = true) {
  return useQuery<Prediction[]>({
    queryKey: queryKeys.predictions,
    queryFn: apiGetPredictions,
    enabled,
    staleTime: 60 * 1000, // Predictions are more stable
  })
}

//Users (Admin)
export function useUsersQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: apiGetUsers,
    enabled,
  })
}

//Audit Log
export function useAuditLogQuery(filters?: Record<string, string>, enabled = true) {
  return useQuery<AuditEntry[]>({
    queryKey: queryKeys.auditLog(filters),
    queryFn: () => apiGetAuditLog(filters),
    enabled,
  })
}

//Heatmap Data
export function useHeatmapQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.heatmap,
    queryFn: apiGetHeatmapData,
    enabled,
    staleTime: 60 * 1000,
  })
}

//Deployments
export function useDeploymentsQuery(enabled = true) {
  return useQuery<Deployment[]>({
    queryKey: queryKeys.deployments,
    queryFn: apiGetDeployments,
    enabled,
    staleTime: 30 * 1000,
  })
}

//Command Center Analytics
export function useAnalyticsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics,
    queryFn: apiGetCommandCenterAnalytics,
    enabled,
    staleTime: 60 * 1000,
  })
}

//News
export function useNewsQuery(includeArchived?: boolean, enabled = true) {
  return useQuery({
    queryKey: queryKeys.news(includeArchived),
    queryFn: () => apiGetNews(includeArchived),
    enabled,
    staleTime: 5 * 60 * 1000, // News is less time-sensitive
  })
}

//Mutations

export function useCreateAlertMutation() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: apiCreateAlert,
    onSuccess: () => {
      //Invalidate alerts cache to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts })
    },
  })
}

export function useDeployResourcesMutation() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ id, operatorId, reason, reportId }: { id: string; operatorId?: string; reason?: string; reportId?: string }) =>
      apiDeployResources(id, operatorId, reason, reportId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deployments })
    },
  })
}

export function useRecallResourcesMutation() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ id, reason, outcomeSummary, reportId, aiFeedback }: { id: string; reason?: string; outcomeSummary?: string; reportId?: string; aiFeedback?: string }) =>
      apiRecallResources(id, reason, outcomeSummary, reportId, aiFeedback),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deployments })
    },
  })
}
