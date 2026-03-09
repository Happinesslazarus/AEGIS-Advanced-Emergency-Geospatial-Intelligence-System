-- ═══════════════════════════════════════════════════════════════════════════════
-- AEGIS v6 — Vector Similarity Search Migration
-- Replaces TEXT-based embedding storage with real vector operations.
-- Uses PostgreSQL cube extension + custom cosine_similarity function.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 1: Install required extensions
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Step 2: Create cosine similarity function for double precision arrays
CREATE OR REPLACE FUNCTION cosine_similarity(a double precision[], b double precision[])
RETURNS double precision AS $$
DECLARE
    dot_product double precision := 0;
    norm_a double precision := 0;
    norm_b double precision := 0;
    i integer;
BEGIN
    IF array_length(a, 1) IS NULL OR array_length(b, 1) IS NULL THEN
        RETURN 0;
    END IF;
    IF array_length(a, 1) != array_length(b, 1) THEN
        RETURN 0;
    END IF;
    FOR i IN 1..array_length(a, 1) LOOP
        dot_product := dot_product + a[i] * b[i];
        norm_a := norm_a + a[i] * a[i];
        norm_b := norm_b + b[i] * b[i];
    END LOOP;
    IF norm_a = 0 OR norm_b = 0 THEN
        RETURN 0;
    END IF;
    RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- Step 3: Add real embedding columns to rag_documents (double precision array)
DO $$
BEGIN
    -- Add embedding_vector column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_documents' AND column_name = 'embedding_vector'
    ) THEN
        ALTER TABLE rag_documents ADD COLUMN embedding_vector double precision[];
    END IF;

    -- Add embedding_model column if not exists  
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_documents' AND column_name = 'embedding_model'
    ) THEN
        ALTER TABLE rag_documents ADD COLUMN embedding_model VARCHAR(100);
    END IF;

    -- Add embedding_dimensions column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_documents' AND column_name = 'embedding_dimensions'
    ) THEN
        ALTER TABLE rag_documents ADD COLUMN embedding_dimensions INTEGER;
    END IF;
END $$;

-- Step 4: Create GIN index on tsvector for full-text fallback (already may exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rag_documents_content_trgm'
    ) THEN
        CREATE INDEX idx_rag_documents_content_trgm ON rag_documents USING gin (content gin_trgm_ops);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rag_documents_tsv'
    ) THEN
        CREATE INDEX idx_rag_documents_tsv ON rag_documents USING gin (to_tsvector('english', content));
    END IF;
END $$;

-- Step 5: Create helper function for vector search
CREATE OR REPLACE FUNCTION search_rag_by_vector(
    query_embedding double precision[],
    match_limit integer DEFAULT 5,
    similarity_threshold double precision DEFAULT 0.3
)
RETURNS TABLE(
    id integer,
    title text,
    content text,
    source text,
    category text,
    similarity double precision
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.title::text,
        r.content::text,
        r.source::text,
        r.category::text,
        cosine_similarity(r.embedding_vector, query_embedding) as similarity
    FROM rag_documents r
    WHERE r.embedding_vector IS NOT NULL
      AND array_length(r.embedding_vector, 1) = array_length(query_embedding, 1)
    ORDER BY cosine_similarity(r.embedding_vector, query_embedding) DESC
    LIMIT match_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 6: Verify installation
DO $$
DECLARE
    test_result double precision;
BEGIN
    -- Test cosine similarity: identical vectors should return 1.0
    test_result := cosine_similarity(
        ARRAY[1.0, 0.0, 0.0]::double precision[],
        ARRAY[1.0, 0.0, 0.0]::double precision[]
    );
    IF test_result != 1.0 THEN
        RAISE EXCEPTION 'cosine_similarity self-test FAILED: expected 1.0, got %', test_result;
    END IF;

    -- Test orthogonal vectors should return 0.0
    test_result := cosine_similarity(
        ARRAY[1.0, 0.0]::double precision[],
        ARRAY[0.0, 1.0]::double precision[]
    );
    IF test_result != 0.0 THEN
        RAISE EXCEPTION 'cosine_similarity orthogonal test FAILED: expected 0.0, got %', test_result;
    END IF;

    RAISE NOTICE 'Vector search infrastructure installed and verified successfully.';
END $$;
