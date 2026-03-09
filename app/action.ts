'use server'

import Mux from "@mux/mux-node"
import { time } from "console"
import { stat } from "fs"
import { text } from "stream/consumers"
const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID!,
    tokenSecret: process.env.MUX_TOKEN_SECRET!,
})

export async function createUploadUrl() {
    const upload = await mux.video.uploads.create({
        new_asset_settings: {
            playback_policy: ["public"],
            video_quality: "plus",
            mp4_support: "standard",
            input: [
                {
                    generated_subtitles: [
                        {
                            language_code: "en",
                            name: "English"
                        }
                    ]
                }
            ]
        },
        cors_origin: "*",
    })
    return upload
}


export async function getAssetIdFromUpload(uploadId: string) {
    const upload = await mux.video.uploads.retrieve(uploadId)

    if (upload.asset_id) {
        const asset = await mux.video.assets.retrieve(upload.asset_id)

        if (asset.playback_ids && asset.playback_ids.length > 0) {
            return {
                playbackId: asset.playback_ids[0].id,
                status: asset.status,
            }
        }

        return { status: asset.status }
    }

    return { status: 'waiting' }
}

export async function listVideos() {
    try {
        const assets = await mux.video.assets.list({
            limit: 25,
        })
        return assets.data
    } catch (error) {
        console.error("Error listing videos:", error)
        return []
    }
}

function formatVttTime(timestamp: string) {
    return timestamp.split('.')[0]
}

export async function getAssetStatus(playbackId: string) {
    try {
        const assets = await mux.video.assets.list({ limit: 25 })
        const asset = assets.data.find(a => a.playback_ids?.some(p => p.id === playbackId))
        if (!asset) return { status: 'errored', transcript: [] }

        let transcript: { time: string; text: string }[] = []
        let transcriptStatus = 'preparing'

        if (asset.status === 'ready' && asset.tracks) {
            const textTrack = asset.tracks.find(t => t.type === 'text' && t.text_type === 'subtitles')

            if (textTrack && textTrack.status === 'ready') {
                transcriptStatus = 'ready'

                const vttUrl = `https://stream.mux.com/${playbackId}/text/${textTrack.id}.vtt `
                const response = await fetch(vttUrl)
                const vttText = await response.text()

                const cues = vttText.split('\n\n').slice(1) // Skip the WEBVTT header
                transcript = cues.reduce<{ time: string; text: string }[]>((acc, cue) => {
                    const lines = cue.split('\n')
                    if (lines.length >= 2 && lines[1].includes('-->')) {
                        const time = formatVttTime(lines[0])
                        const text = lines.slice(2).join(' ')
                        acc.push({ time, text })
                    }
                    return acc
                }, [])
            }
            return { status: asset.status,  transcriptStatus, transcript }
        }
    } catch (error) {
        console.error("Error fetching asset status:", error)
        return { status: 'errored', transcriptStatus: 'errored', transcript: [] }
    }
}