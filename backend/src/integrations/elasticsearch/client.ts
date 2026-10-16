import { Client } from '@elastic/elasticsearch';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export const EMAIL_INDEX = 'reachinbox_emails';

let esClientInstance: Client | null = null;
let esAvailable = false;

export function getElasticsearchClient(): Client {
  if (!esClientInstance) {
    const auth =
      env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
        ? {
            username: env.ELASTICSEARCH_USERNAME,
            password: env.ELASTICSEARCH_PASSWORD,
          }
        : undefined;

    esClientInstance = new Client({
      node: env.ELASTICSEARCH_URL,
      auth,
      maxRetries: 2,
      requestTimeout: 4000,
    });
  }
  return esClientInstance;
}

export async function initElasticsearch(): Promise<boolean> {
  const client = getElasticsearchClient();
  try {
    const ping = await client.ping();
    if (!ping) {
      logger.warn('Elasticsearch ping returned false');
      esAvailable = false;
      return false;
    }

    esAvailable = true;
    logger.info('Connected to Elasticsearch successfully');

    // Ensure email index exists with mappings
    const exists = await client.indices.exists({ index: EMAIL_INDEX });
    if (!exists) {
      await client.indices.create({
        index: EMAIL_INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            campaignId: { type: 'keyword' },
            ownerId: { type: 'keyword' },
            recipientEmail: {
              type: 'text',
              fields: {
                raw: { type: 'keyword' },
              },
            },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            senderEmail: { type: 'keyword' },
            createdAt: { type: 'date' },
          },
        },
      });
      logger.info(`Elasticsearch index [${EMAIL_INDEX}] created with mappings`);
    }

    return true;
  } catch (error) {
    esAvailable = false;
    logger.warn({ error }, 'Elasticsearch is currently unavailable; system will use database fallback for search');
    return false;
  }
}

export function isElasticsearchAvailable(): boolean {
  return esAvailable;
}

export interface EmailDocument {
  id: string;
  campaignId: string;
  ownerId: string;
  recipientEmail: string;
  subject: string;
  body?: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  senderEmail: string;
  createdAt: string;
}

export async function indexEmailDocument(doc: EmailDocument): Promise<boolean> {
  const client = getElasticsearchClient();
  try {
    await client.index({
      index: EMAIL_INDEX,
      id: doc.id,
      document: doc,
      refresh: 'wait_for',
    });
    return true;
  } catch (error) {
    logger.error({ error, docId: doc.id }, 'Failed to index email in Elasticsearch');
    return false;
  }
}

export interface SearchEmailsParams {
  ownerId: string;
  query: string;
  status?: string;
  page?: number;
  limit?: number;
}

export async function searchEmailsInES(params: SearchEmailsParams) {
  const client = getElasticsearchClient();
  const page = params.page || 1;
  const limit = params.limit || 20;
  const from = (page - 1) * limit;

  const mustClauses: any[] = [
    { term: { ownerId: params.ownerId } },
  ];

  if (params.status) {
    mustClauses.push({ term: { status: params.status } });
  }

  if (params.query && params.query.trim().length > 0) {
    mustClauses.push({
      multi_match: {
        query: params.query,
        fields: ['recipientEmail^3', 'subject^2', 'body', 'senderEmail'],
        fuzziness: 'AUTO',
      },
    });
  }

  const result = await client.search({
    index: EMAIL_INDEX,
    from,
    size: limit,
    query: {
      bool: {
        must: mustClauses,
      },
    },
    sort: [{ scheduledAt: { order: 'desc' } }],
  });

  const total = typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
  const hits = result.hits.hits.map((h) => h._source);

  return {
    hits,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
