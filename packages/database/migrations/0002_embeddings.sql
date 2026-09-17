-- Retrieval corpus for legal research.
--
-- The product advertises "RAG over corpus" and "citation verification". Neither
-- existed: the search, ingestion and embeddings services were one-line stubs.
-- This is the storage half — a chunk cannot be stored without naming the
-- registered legal source it came from, so retrieval can only ever return text
-- whose provenance is known, and the verification layer can resolve any citation
-- back to a source row.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE source_chunks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- No orphan text: every chunk traces to a source in the registry.
    source_id     text NOT NULL REFERENCES legal_sources(id) ON DELETE CASCADE,
    -- Paragraph/section reference within the source, used for citation.
    locator       text NOT NULL,
    content       text NOT NULL,
    -- sha-256 of `content`, so a retrieved chunk can be shown to match the text
    -- that was ingested and checksummed.
    content_hash  char(64) NOT NULL,
    token_count   integer NOT NULL CHECK (token_count > 0),
    embedding     vector(1536),
    ingested_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, locator, content_hash)
);

CREATE INDEX source_chunks_source_id_idx ON source_chunks(source_id);

-- Cosine distance index for retrieval. Built on the embedding column only;
-- filtering by source_id happens before the vector search in the query plan.
CREATE INDEX source_chunks_embedding_idx
    ON source_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
